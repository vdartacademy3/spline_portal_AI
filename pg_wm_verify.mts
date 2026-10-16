/**
 * Real-PostgreSQL verification of the work_minutes authority, using the same
 * metric function the application runs, writing through the real REST path.
 * Browser authentication is covered separately by att_browser.cjs.
 */
import { createClient } from "@supabase/supabase-js";
import { computeMetrics, aggregateMonthly, monthBounds } from "./src/lib/attendance.functions";
import { config } from "dotenv";

config({ path: "backend/.env" });
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const URL = process.env.SUPABASE_URL!;
const db = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let pass = 0;
const failures = [];
const check = (name, actual, expected) => {
  if (String(actual) === String(expected)) {
    pass++;
    console.log(`[PASS] ${name} :: actual=${actual}`);
  } else {
    failures.push(name);
    console.log(`[FAIL] ${name} :: actual=${actual} expected=${expected}`);
  }
};
const info = (n, v) => console.log(`  ..  ${n} = ${v}`);

/** Resolve the employee's effective shift, mirroring loadShift. */
async function loadShift(employeeId, onDate) {
  const { data, error } = await db
    .from("employee_shift_assignments")
    .select("*, shift:shifts(*)")
    .eq("employee_id", employeeId)
    .eq("is_active", true)
    .lte("effective_from", onDate);
  if (error) throw error;
  const rows = data ?? [];
  const eligible = rows.filter(
    (r) => r.effective_to == null || String(r.effective_to).slice(0, 10) >= onDate,
  );
  return eligible.sort(
    (a, b) => String(b.effective_from).localeCompare(String(a.effective_from)),
  )[0]?.shift ?? null;
}

const toMin = (t) => {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};
const hmm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/** Build the ISO instants for a wall-clock check-in/out pair, honouring overnight. */
function instants(day, cin, cout) {
  const iso = (d, t) => new Date(`${d}T${t}:00Z`).toISOString();
  let outDay = day;
  if (toMin(cout) <= toMin(cin)) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    outDay = d.toISOString().slice(0, 10);
  }
  return { cin, cout, inIso: iso(day, cin), outIso: iso(outDay, cout) };
}

/** Push a row through the real REST write path, exactly as check-in/out does. */
async function writeDay({ employeeId, day, cin, cout, source }) {
  const shift = await loadShift(employeeId, day);
  const t = instants(day, cin, cout);
  const m = computeMetrics({
    shift,
    localDate: day,
    localCheckIn: t.cin,
    localCheckOut: cout,
    checkInIso: t.inIso,
    checkOutIso: t.outIso,
  });
  const { data, error } = await db
    .from("attendance_records")
    .upsert(
      {
        employee_id: employeeId,
        work_date: day,
        check_in: t.inIso,
        check_out: t.outIso,
        status: m.status,
        late_minutes: m.late_minutes,
        early_login_minutes: m.early_login_minutes,
        overtime_minutes: m.overtime_minutes,
        late_logout_minutes: m.late_logout_minutes,
        early_departure_minutes: m.early_departure_minutes,
        work_minutes: m.work_minutes,
        work_hours: m.work_hours,
        is_half_day: m.is_half_day,
        source,
      },
      { onConflict: "employee_id,work_date" },
    )
    .select()
    .single();
  if (error) throw error;
  return { row: data, metrics: m, shift };
}

const GEN_EMP = "55555555-0000-0000-0000-000000000007"; // Ananya, General shift
const NIGHT_EMP = "55555555-0000-0000-0000-000000000004"; // Daniel, Night shift
const DAY = "2026-09-20";

(async () => {
  try {
    console.log("=== A. work_minutes WRITTEN TO POSTGRESQL ===");
    const gen = await writeDay({
      employeeId: GEN_EMP,
      day: DAY,
      cin: "08:45",
      cout: "17:30",
      source: "wm_verification",
    });
    info("shift", `${gen.shift.name} break=${gen.shift.break_minutes}m`);
    check("stored work_minutes = 465", gen.row.work_minutes, 465);
    check("stored work_minutes matches the metric function", gen.row.work_minutes, gen.metrics.work_minutes);
    check("legacy work_hours kept in sync", gen.row.work_hours, 7.75);
    check("displayed as 7h 45m", hmm(gen.row.work_minutes), "7h 45m");
    check("break deducted exactly once (525-60)", gen.row.work_minutes, 525 - 60);
    check("early login 15m", gen.row.early_login_minutes, 15);
    check("early logout 30m", gen.row.early_departure_minutes, 30);
    check("overtime 0m", gen.row.overtime_minutes, 0);

    const odd = await writeDay({
      employeeId: GEN_EMP,
      day: "2026-09-21",
      cin: "08:47",
      cout: "18:42",
      source: "wm_verification",
    });
    check("odd-minute day stored exactly (535)", odd.row.work_minutes, 535);
    check("not a 6-minute multiple", odd.row.work_minutes % 6, 535 % 6);
    check("displayed as 8h 55m", hmm(odd.row.work_minutes), "8h 55m");

    const ot = await writeDay({
      employeeId: GEN_EMP,
      day: "2026-09-22",
      cin: "09:00",
      cout: "19:00",
      source: "wm_verification",
    });
    check("overtime day work_minutes = 540", ot.row.work_minutes, 540);
    check("overtime = 60m (9h actual - 8h net)", ot.row.overtime_minutes, 60);
    check("late logout 60m", ot.row.late_logout_minutes, 60);

    const exact = await writeDay({
      employeeId: GEN_EMP,
      day: "2026-09-23",
      cin: "09:00",
      cout: "18:00",
      source: "wm_verification",
    });
    check("full-shift day = 480m", exact.row.work_minutes, 480);
    check("no overtime on a full shift", exact.row.overtime_minutes, 0);

    const late = await writeDay({
      employeeId: GEN_EMP,
      day: "2026-09-24",
      cin: "09:20",
      cout: "18:00",
      source: "wm_verification",
    });
    check("late login = 20m", late.row.late_minutes, 20);
    check("late day work_minutes = 460", late.row.work_minutes, 460);

    console.log("\n=== B. OVERNIGHT ===");
    const night = await writeDay({
      employeeId: NIGHT_EMP,
      day: "2026-09-20",
      cin: "22:00",
      cout: "06:15",
      source: "wm_verification",
    });
    info("shift", `${night.shift.name} break=${night.shift.break_minutes}m overnight=${night.shift.overnight}`);
    check("overnight stored on the check-in date", night.row.work_date, "2026-09-20");
    check("checkout landed on the next day", String(night.row.check_out).slice(0, 10), "2026-09-21");
    check("overnight work_minutes = 450", night.row.work_minutes, 450);
    check("no ~24h logout bug", night.row.late_logout_minutes < 120, true);
    check("late logout 15m", night.row.late_logout_minutes, 15);
    check("early logout 0m", night.row.early_departure_minutes, 0);
    check("overtime 15m", night.row.overtime_minutes, 15);

    console.log("\n=== C. PERSISTENCE: re-read straight from PostgreSQL ===");
    const { data: reread, error: rerr } = await db
      .from("attendance_records")
      .select("work_date, work_minutes, work_hours, overtime_minutes, late_logout_minutes, source")
      .eq("employee_id", GEN_EMP)
      .eq("source", "wm_verification")
      .order("work_date");
    if (rerr) throw rerr;
    check("verification rows persisted", reread.length, 6);
    for (const r of reread) {
      const sync = r.work_minutes == null ? null : Math.round(r.work_hours * 60);
      console.log(
        `    ${r.work_date} wm=${String(r.work_minutes).padStart(3)} (${hmm(r.work_minutes)}) ` +
          `wh=${r.work_hours} sync=${sync === r.work_minutes ? "ok" : "DRIFT"} ot=${r.overtime_minutes}`,
      );
    }
    const drift = reread.filter(
      (r) => r.work_minutes != null && Math.round(r.work_hours * 60) !== r.work_minutes,
    );
    check("every row's work_hours still mirrors work_minutes", drift.length, 0);

    console.log("\n=== D. MONTHLY AGGREGATION FROM THE DATABASE ===");
    const { start, end } = monthBounds("2026-09");
    info("bounds", `${start} .. ${end}`);
    const { data: monthRows, error: merr } = await db
      .from("attendance_records")
      .select("work_date, check_in, check_out, status, late_minutes, early_login_minutes, overtime_minutes, late_logout_minutes, early_departure_minutes, work_minutes, work_hours")
      .eq("employee_id", GEN_EMP)
      .gte("work_date", start)
      .lte("work_date", end);
    if (merr) throw merr;
    const s = aggregateMonthly("2026-09", monthRows);
    info("records", `${s.totalRecords}  completed ${s.completedDays}  withMinutes ${s.completedDaysWithHours}  incomplete ${s.incompleteDays}`);
    info("total", `${s.totalWorkMinutes}m (${hmm(s.totalWorkMinutes)})`);
    info("average", `${s.averageWorkMinutes}m (${hmm(s.averageWorkMinutes)})`);
    info("overtime", `${s.totalOvertimeMinutes}m`);
    info("counts", `earlyLogin ${s.earlyLoginCount} lateLogin ${s.lateLoginCount} earlyLogout ${s.earlyLogoutCount} lateLogout ${s.lateLogoutCount}`);

    const completed = monthRows.filter((r) => r.check_in && r.check_out);
    const dbTotal = completed.reduce((a, r) => a + (r.work_minutes ?? 0), 0);
    const dbAvg = Math.round(dbTotal / completed.length);
    check("monthly total equals the SQL sum of work_minutes", s.totalWorkMinutes, dbTotal);
    check("monthly average = total / completed days", s.averageWorkMinutes, dbAvg);
    check("completed day count matches the database", s.completedDays, completed.length);
    check("average never exceeds total", s.averageWorkMinutes <= s.totalWorkMinutes, true);
    check("the open 2026-09-04 day is counted incomplete", s.incompleteDays >= 1, true);

    console.log("\n=== E. MONTHS PRESENT IN THE DATABASE ===");
    const { data: allDates, error: aerr } = await db
      .from("attendance_records")
      .select("work_date");
    if (aerr) throw aerr;
    const months = [...new Set(allDates.map((r) => r.work_date.slice(0, 7)))].sort().reverse();
    info("distinct months", JSON.stringify(months));
    check("selector source returns at least one month", months.length > 0, true);
    check("September holds the seeded rows", months.includes("2026-09"), true);

    console.log("\n=== CLEANUP ===");
    const { error: derr } = await db
      .from("attendance_records")
      .delete()
      .eq("source", "wm_verification");
    if (derr) throw derr;
    const { data: left } = await db
      .from("attendance_records")
      .select("id")
      .eq("source", "wm_verification");
    check("verification rows removed", (left ?? []).length, 0);
  } catch (err) {
    failures.push(`EXCEPTION: ${err.message}`);
    console.log(`[ERROR] ${err.stack}`);
  }

  console.log("\n========================================");
  console.log(`PG VERIFICATION RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log(`  FAILED: ${f}`));
  console.log(failures.length ? "PG_VERIFY_FAIL" : "PG_VERIFY_OK");
  process.exit(failures.length ? 1 : 0);
})();
