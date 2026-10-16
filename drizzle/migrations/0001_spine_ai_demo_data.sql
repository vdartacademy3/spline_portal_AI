
-- Organization
insert into public.organizations (id, name, code, industry, timezone, currency)
values ('11111111-1111-1111-1111-111111111111','Northwind Technologies','NWT','Technology','Asia/Kolkata','USD');

insert into public.legal_entities (id, organization_id, name, code, registration_number) values
('22222222-2222-2222-2222-222222222201','11111111-1111-1111-1111-111111111111','Northwind Technologies Pvt Ltd','NWT-IN','U72900KA2015PTC080123'),
('22222222-2222-2222-2222-222222222202','11111111-1111-1111-1111-111111111111','Northwind Technologies Inc','NWT-US','DE-7781204');

insert into public.locations (id, organization_id, legal_entity_id, name, city, country, timezone) values
('33333333-3333-3333-3333-333333333301','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','Bengaluru HQ','Bengaluru','India','Asia/Kolkata'),
('33333333-3333-3333-3333-333333333302','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','Chennai Office','Chennai','India','Asia/Kolkata'),
('33333333-3333-3333-3333-333333333303','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222202','Austin Office','Austin','United States','America/Chicago');

insert into public.departments (id, organization_id, name, code) values
('44444444-4444-4444-4444-444444444401','11111111-1111-1111-1111-111111111111','Engineering','ENG'),
('44444444-4444-4444-4444-444444444402','11111111-1111-1111-1111-111111111111','Human Resources','HR'),
('44444444-4444-4444-4444-444444444403','11111111-1111-1111-1111-111111111111','Sales','SLS'),
('44444444-4444-4444-4444-444444444404','11111111-1111-1111-1111-111111111111','Finance','FIN'),
('44444444-4444-4444-4444-444444444405','11111111-1111-1111-1111-111111111111','Customer Success','CS');

-- Employees (leaders first)
insert into public.employees (id, employee_code, first_name, last_name, work_email, phone, gender, joining_date, designation, employment_type, employment_status, organization_id, legal_entity_id, location_id, department_id, manager_id, probation_end_date) values
('55555555-0000-0000-0000-000000000001','NWT-0001','Meera','Raghavan','meera.raghavan@northwind.io','+91 98450 11001','female','2016-04-11','Chief People Officer','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444402',null,null),
('55555555-0000-0000-0000-000000000002','NWT-0002','Arjun','Nair','arjun.nair@northwind.io','+91 98450 11002','male','2017-01-09','VP Engineering','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444401',null,null),
('55555555-0000-0000-0000-000000000003','NWT-0003','Priya','Deshpande','priya.deshpande@northwind.io','+91 98450 11003','female','2018-06-18','HR Manager','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444402','55555555-0000-0000-0000-000000000001',null),
('55555555-0000-0000-0000-000000000004','NWT-0004','Daniel','Okafor','daniel.okafor@northwind.io','+1 512 555 0104','male','2019-02-25','Engineering Manager','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222202','33333333-3333-3333-3333-333333333303','44444444-4444-4444-4444-444444444401','55555555-0000-0000-0000-000000000002',null),
('55555555-0000-0000-0000-000000000005','NWT-0005','Sneha','Kulkarni','sneha.kulkarni@northwind.io','+91 98450 11005','female','2020-08-03','Sales Director','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333302','44444444-4444-4444-4444-444444444403',null,null),
('55555555-0000-0000-0000-000000000006','NWT-0006','Vikram','Shetty','vikram.shetty@northwind.io','+91 98450 11006','male','2021-03-15','Senior Software Engineer','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444401','55555555-0000-0000-0000-000000000004',null),
('55555555-0000-0000-0000-000000000007','NWT-0007','Ananya','Iyer','ananya.iyer@northwind.io','+91 98450 11007','female','2022-07-04','Software Engineer','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444401','55555555-0000-0000-0000-000000000004',null),
('55555555-0000-0000-0000-000000000008','NWT-0008','Rahul','Menon','rahul.menon@northwind.io','+91 98450 11008','male','2026-07-20','Software Engineer','full_time','probation','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333302','44444444-4444-4444-4444-444444444401','55555555-0000-0000-0000-000000000004','2026-10-20'),
('55555555-0000-0000-0000-000000000009','NWT-0009','Grace','Lin','grace.lin@northwind.io','+1 512 555 0109','female','2023-09-11','QA Engineer','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222202','33333333-3333-3333-3333-333333333303','44444444-4444-4444-4444-444444444401','55555555-0000-0000-0000-000000000004',null),
('55555555-0000-0000-0000-000000000010','NWT-0010','Karthik','Subramanian','karthik.s@northwind.io','+91 98450 11010','male','2024-01-08','Account Executive','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333302','44444444-4444-4444-4444-444444444403','55555555-0000-0000-0000-000000000005',null),
('55555555-0000-0000-0000-000000000011','NWT-0011','Fatima','Sheikh','fatima.sheikh@northwind.io','+91 98450 11011','female','2024-05-02','Customer Success Manager','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444405','55555555-0000-0000-0000-000000000001',null),
('55555555-0000-0000-0000-000000000012','NWT-0012','Joseph','Mathew','joseph.mathew@northwind.io','+91 98450 11012','male','2022-11-14','Financial Analyst','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444404','55555555-0000-0000-0000-000000000001',null),
('55555555-0000-0000-0000-000000000013','NWT-0013','Neha','Gupta','neha.gupta@northwind.io','+91 98450 11013','female','2026-08-10','HR Executive','full_time','probation','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333301','44444444-4444-4444-4444-444444444402','55555555-0000-0000-0000-000000000003','2026-11-10'),
('55555555-0000-0000-0000-000000000014','NWT-0014','Miguel','Santos','miguel.santos@northwind.io','+1 512 555 0114','male','2025-02-17','DevOps Engineer','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222202','33333333-3333-3333-3333-333333333303','44444444-4444-4444-4444-444444444401','55555555-0000-0000-0000-000000000004',null),
('55555555-0000-0000-0000-000000000015','NWT-0015','Divya','Pillai','divya.pillai@northwind.io','+91 98450 11015','female','2025-06-23','Support Specialist','full_time','active','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222201','33333333-3333-3333-3333-333333333302','44444444-4444-4444-4444-444444444405','55555555-0000-0000-0000-000000000011',null);

update public.departments set department_head_id = '55555555-0000-0000-0000-000000000002' where code = 'ENG';
update public.departments set department_head_id = '55555555-0000-0000-0000-000000000001' where code = 'HR';
update public.departments set department_head_id = '55555555-0000-0000-0000-000000000005' where code = 'SLS';
update public.departments set department_head_id = '55555555-0000-0000-0000-000000000012' where code = 'FIN';
update public.departments set department_head_id = '55555555-0000-0000-0000-000000000011' where code = 'CS';

-- Attendance for last 45 days (weekdays)
insert into public.attendance_records (employee_id, work_date, check_in, check_out, status, late_minutes, overtime_minutes)
select e.id,
       d::date,
       (d + time '09:00') + (case when (hashtext(e.employee_code || d::text) % 7) = 0 then interval '48 minutes' else interval '4 minutes' end),
       (d + time '18:10'),
       case
         when (hashtext(e.employee_code || d::text) % 23) = 0 then 'absent'
         when (hashtext(e.employee_code || d::text) % 7) = 0 then 'late'
         else 'present' end,
       case when (hashtext(e.employee_code || d::text) % 7) = 0 then 48 else 0 end,
       case when (hashtext(e.employee_code || d::text) % 11) = 0 then 75 else 0 end
from public.employees e
cross join generate_series(current_date - 45, current_date - 1, interval '1 day') d
where extract(isodow from d) < 6;

-- Leave types and balances
insert into public.leave_types (id, organization_id, name, code, annual_quota, paid) values
('66666666-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Annual Leave','AL',24,true),
('66666666-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Sick Leave','SL',12,true),
('66666666-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Maternity Leave','ML',182,true),
('66666666-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Unpaid Leave','UL',0,false);

insert into public.leave_balances (employee_id, leave_type_id, year, entitled, used)
select e.id, t.id, extract(year from now())::int, t.annual_quota,
       least(t.annual_quota, (abs(hashtext(e.employee_code || t.code)) % 9))
from public.employees e cross join public.leave_types t where t.code in ('AL','SL');

insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status, approver_id, decided_at) values
('55555555-0000-0000-0000-000000000007','66666666-0000-0000-0000-000000000001', current_date, current_date + 2, 3,'Family function','approved','55555555-0000-0000-0000-000000000004', now() - interval '3 days'),
('55555555-0000-0000-0000-000000000009','66666666-0000-0000-0000-000000000002', current_date, current_date, 1,'Fever','approved','55555555-0000-0000-0000-000000000004', now() - interval '1 day'),
('55555555-0000-0000-0000-000000000006','66666666-0000-0000-0000-000000000001', current_date + 6, current_date + 10, 5,'Vacation','pending',null,null),
('55555555-0000-0000-0000-000000000008','66666666-0000-0000-0000-000000000002', current_date + 1, current_date + 1, 1,'Medical appointment','pending',null,null),
('55555555-0000-0000-0000-000000000010','66666666-0000-0000-0000-000000000001', current_date + 12, current_date + 14, 3,'Personal','pending',null,null),
('55555555-0000-0000-0000-000000000014','66666666-0000-0000-0000-000000000001', current_date + 3, current_date + 4, 2,'Travel','pending',null,null),
('55555555-0000-0000-0000-000000000015','66666666-0000-0000-0000-000000000002', current_date - 5, current_date - 4, 2,'Flu','rejected','55555555-0000-0000-0000-000000000011', now() - interval '6 days');

-- Goals and reviews
insert into public.goals (employee_id, title, description, due_date, progress, status) values
('55555555-0000-0000-0000-000000000006','Ship billing service v2','Deliver the new billing microservice to production', current_date + 20, 70,'in_progress'),
('55555555-0000-0000-0000-000000000006','Mentor two juniors','Structured mentoring plan for Q3', current_date + 40, 45,'in_progress'),
('55555555-0000-0000-0000-000000000007','Reduce API latency 30%','Optimise the reporting endpoints', current_date + 9, 60,'in_progress'),
('55555555-0000-0000-0000-000000000009','Automate regression suite','Cover critical flows with automation', current_date + 14, 85,'in_progress'),
('55555555-0000-0000-0000-000000000010','Close $450K new ARR','FY quota attainment', current_date + 60, 52,'in_progress'),
('55555555-0000-0000-0000-000000000015','Cut first-response time','Target under 2 hours', current_date - 3, 100,'completed');

insert into public.performance_reviews (employee_id, reviewer_id, period, rating, strengths, improvements, summary, status) values
('55555555-0000-0000-0000-000000000006','55555555-0000-0000-0000-000000000004','H1 2026',4.4,'Deep technical ownership, strong mentoring','Delegation, written design docs','Consistently high performer with growing leadership scope.','published'),
('55555555-0000-0000-0000-000000000007','55555555-0000-0000-0000-000000000004','H1 2026',3.9,'Fast learner, reliable delivery','Estimation accuracy','Solid contributor trending upward.','published'),
('55555555-0000-0000-0000-000000000009','55555555-0000-0000-0000-000000000004','H1 2026',4.1,'Quality mindset, thorough testing','Cross-team communication','Strong quality anchor for the platform team.','published'),
('55555555-0000-0000-0000-000000000010','55555555-0000-0000-0000-000000000005','H1 2026',3.4,'Pipeline generation','Deal qualification, forecasting','Meets expectations, needs forecast discipline.','published'),
('55555555-0000-0000-0000-000000000015','55555555-0000-0000-0000-000000000011','H1 2026',3.8,'Customer empathy','Documentation of resolutions','Dependable support specialist.','draft');

-- Documents
insert into public.employee_documents (employee_id, name, category, expiry_date, verification_status) values
('55555555-0000-0000-0000-000000000006','Employment Contract','contract',null,'verified'),
('55555555-0000-0000-0000-000000000006','Passport','identity', current_date + 25,'verified'),
('55555555-0000-0000-0000-000000000007','Offer Letter','offer_letter',null,'verified'),
('55555555-0000-0000-0000-000000000008','Background Verification','certificate', current_date + 12,'pending'),
('55555555-0000-0000-0000-000000000009','Work Visa','identity', current_date + 18,'verified'),
('55555555-0000-0000-0000-000000000014','Work Permit','identity', current_date + 55,'verified'),
('55555555-0000-0000-0000-000000000010','Policy Acknowledgement','policy',null,'pending'),
('55555555-0000-0000-0000-000000000013','Education Certificate','certificate',null,'pending');

-- Recruitment
insert into public.job_requisitions (id, title, department_id, location_id, employment_type, experience_min, experience_max, skills, salary_min, salary_max, hiring_manager_id, openings, status) values
('77777777-0000-0000-0000-000000000001','Senior Backend Engineer','44444444-4444-4444-4444-444444444401','33333333-3333-3333-3333-333333333301','full_time',5,9,'{Go,PostgreSQL,Kubernetes,AWS}',45000,70000,'55555555-0000-0000-0000-000000000004',2,'open'),
('77777777-0000-0000-0000-000000000002','Product Designer','44444444-4444-4444-4444-444444444401','33333333-3333-3333-3333-333333333302','full_time',3,6,'{Figma,"Design Systems","User Research"}',30000,45000,'55555555-0000-0000-0000-000000000002',1,'open'),
('77777777-0000-0000-0000-000000000003','Enterprise Account Executive','44444444-4444-4444-4444-444444444403','33333333-3333-3333-3333-333333333303','full_time',6,12,'{SaaS,"Enterprise Sales",Negotiation}',60000,95000,'55555555-0000-0000-0000-000000000005',2,'open'),
('77777777-0000-0000-0000-000000000004','HR Operations Specialist','44444444-4444-4444-4444-444444444402','33333333-3333-3333-3333-333333333301','full_time',2,5,'{HRIS,Payroll,Compliance}',18000,28000,'55555555-0000-0000-0000-000000000003',1,'on_hold');

insert into public.candidates (job_id, full_name, email, phone, skills, experience_years, education, source, stage, match_score) values
('77777777-0000-0000-0000-000000000001','Rohit Verma','rohit.verma@example.com','+91 99000 20001','{Go,PostgreSQL,Docker}',7,'B.Tech Computer Science','LinkedIn','interview',87),
('77777777-0000-0000-0000-000000000001','Emily Chen','emily.chen@example.com','+1 415 555 2002','{Go,Kubernetes,AWS,Terraform}',8,'MS Computer Science','Referral','evaluation',92),
('77777777-0000-0000-0000-000000000001','Sanjay Rao','sanjay.rao@example.com','+91 99000 20003','{Java,Spring,MySQL}',6,'B.E Information Science','Job Board','screening',61),
('77777777-0000-0000-0000-000000000002','Laura Mendes','laura.mendes@example.com','+351 910 200 004','{Figma,"Design Systems"}',5,'BA Design','Portfolio','interview',84),
('77777777-0000-0000-0000-000000000002','Tanvi Shah','tanvi.shah@example.com','+91 99000 20005','{Figma,Prototyping}',3,'B.Des','LinkedIn','applied',72),
('77777777-0000-0000-0000-000000000003','Marcus Hall','marcus.hall@example.com','+1 512 555 2006','{SaaS,"Enterprise Sales"}',11,'MBA','Referral','offer',89),
('77777777-0000-0000-0000-000000000003','Aisha Bello','aisha.bello@example.com','+1 512 555 2007','{SaaS,Negotiation}',7,'BSc Economics','Job Board','screening',68),
('77777777-0000-0000-0000-000000000004','Pooja Nambiar','pooja.n@example.com','+91 99000 20008','{HRIS,Payroll}',4,'MBA HR','LinkedIn','applied',75);

-- Onboarding
insert into public.onboarding_tasks (employee_id, title, owner, due_date, status) values
('55555555-0000-0000-0000-000000000008','Documents submitted','HR', current_date - 20,'completed'),
('55555555-0000-0000-0000-000000000008','Background verification','HR', current_date - 5,'in_progress'),
('55555555-0000-0000-0000-000000000008','IT account creation','IT', current_date - 18,'completed'),
('55555555-0000-0000-0000-000000000008','Laptop allocation','IT', current_date - 18,'completed'),
('55555555-0000-0000-0000-000000000008','Policy acknowledgement','Employee', current_date - 2,'pending'),
('55555555-0000-0000-0000-000000000008','Manager introduction','Manager', current_date - 15,'completed'),
('55555555-0000-0000-0000-000000000008','Probation setup','HR', current_date + 4,'pending'),
('55555555-0000-0000-0000-000000000013','Documents submitted','HR', current_date - 10,'completed'),
('55555555-0000-0000-0000-000000000013','Orientation','HR', current_date - 8,'completed'),
('55555555-0000-0000-0000-000000000013','Training plan','Manager', current_date - 1,'in_progress'),
('55555555-0000-0000-0000-000000000013','Policy acknowledgement','Employee', current_date + 3,'pending');

-- Helpdesk
insert into public.helpdesk_tickets (employee_id, category, subject, description, priority, status, assigned_to) values
('55555555-0000-0000-0000-000000000007','leave','Leave balance looks incorrect','My annual leave balance shows 3 days less than expected.','medium','in_progress','55555555-0000-0000-0000-000000000003'),
('55555555-0000-0000-0000-000000000010','payroll','Reimbursement not credited','Travel reimbursement from last month is still pending.','high','open','55555555-0000-0000-0000-000000000003'),
('55555555-0000-0000-0000-000000000015','policy','Work from home policy clarification','How many WFH days are allowed per month?','low','resolved','55555555-0000-0000-0000-000000000013'),
('55555555-0000-0000-0000-000000000014','it','Need VPN access','Requesting VPN access for the production network.','medium','waiting_employee','55555555-0000-0000-0000-000000000013'),
('55555555-0000-0000-0000-000000000009','benefits','Insurance card missing','I have not received my insurance card yet.','medium','open',null);

-- Knowledge base
insert into public.kb_documents (id, title, category, content) values
('88888888-0000-0000-0000-000000000001','Leave Policy','policy','Northwind employees receive 24 days of annual leave and 12 days of sick leave per calendar year. Annual leave must be requested at least 5 working days in advance and requires manager approval. Up to 6 unused annual leave days may be carried into the next year. Sick leave beyond 2 consecutive days requires a medical certificate. Maternity leave is 26 weeks of paid leave; paternity leave is 15 days.'),
('88888888-0000-0000-0000-000000000002','Attendance Policy','policy','Standard working hours are 09:00 to 18:00 local time with a one hour break. Arrival after 09:30 is recorded as late. Three or more late arrivals in a calendar month trigger an HR follow-up conversation. Overtime beyond 60 minutes must be approved by the reporting manager. Unreported absence for three consecutive days is treated as absconding.'),
('88888888-0000-0000-0000-000000000003','Employee Handbook','handbook','The handbook covers our values, working model, hybrid work expectations of three office days per week, expense guidelines, travel booking, internal mobility, referral bonuses, and the grievance redressal process. Employees may raise concerns anonymously through the HR helpdesk.'),
('88888888-0000-0000-0000-000000000004','Code of Conduct','policy','All employees must act with integrity, protect confidential workforce and customer data, avoid conflicts of interest, and report harassment or discrimination immediately. Violations are investigated by HR and may lead to disciplinary action up to termination.'),
('88888888-0000-0000-0000-000000000005','Benefits Policy','benefits','Full-time employees receive group medical insurance covering self, spouse and two children, an annual health check, a learning allowance of 1,000 USD per year, a home office stipend, and access to the employee assistance programme.');

insert into public.kb_chunks (document_id, chunk_index, heading, content)
select id, 0, title, content from public.kb_documents;

-- AI insights
insert into public.ai_insights (title, detail, severity, recommended_action, link) values
('Repeated attendance anomalies detected','Several employees recorded three or more late arrivals in the last 30 days, concentrated in Engineering.','warning','Review flagged employees and start an HR follow-up','/attendance'),
('Probation reviews due this month','2 employees have probation periods ending within 60 days and no scheduled review.','warning','Schedule probation reviews','/performance'),
('Onboarding tasks overdue','3 onboarding tasks passed their due date and remain incomplete.','critical','Reassign owners and close overdue tasks','/onboarding'),
('Documents expiring soon','4 employee documents expire within 30 days, including two work authorisations.','warning','Request renewed documents','/documents'),
('Hiring pipeline slowing','Engineering pipeline conversion from screening to interview dropped compared with last month.','info','Review sourcing channels with the hiring manager','/recruitment');
