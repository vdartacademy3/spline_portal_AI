create extension if not exists vector with schema extensions;

alter table public.kb_chunks
  add column if not exists embedding extensions.vector(1536),
  add column if not exists embedding_model text,
  add column if not exists content_hash text,
  add column if not exists embedded_at timestamptz;

create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops);

create index if not exists kb_chunks_document_idx on public.kb_chunks(document_id);

-- Chunk visibility must mirror its parent document, so semantic matches can never
-- surface knowledge the caller is not authorized to read.
drop policy if exists "kbc read" on public.kb_chunks;
create policy "kbc read" on public.kb_chunks for select to authenticated
using (
  exists (
    select 1 from public.kb_documents d
    where d.id = kb_chunks.document_id
      and (d.status = 'published' or public.has_permission(auth.uid(),'manage_knowledge'))
  )
);

-- Security INVOKER: row level security on kb_chunks / kb_documents still applies,
-- so similarity search is filtered by the caller's own authorization.
create or replace function public.match_kb_chunks(
  query_embedding extensions.vector(1536),
  match_count int default 5,
  similarity_threshold float default 0.15
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  heading text,
  content text,
  similarity float
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select c.id,
         c.document_id,
         d.title,
         c.heading,
         c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  where c.embedding is not null
    and d.status = 'published'
    and 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

grant execute on function public.match_kb_chunks(extensions.vector, int, float) to authenticated, service_role;
