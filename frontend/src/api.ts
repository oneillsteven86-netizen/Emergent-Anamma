/**
 * Supabase API shim for ANAM MMA.
 *
 * Keeps the call sites stable while the transport now goes through
 * @supabase/supabase-js (Auth + PostgREST + RPC).
 *
 * Old call style preserved:
 *   await api("/some/path", { method, body, raw })
 *
 * Every path below is rewritten to a Supabase query / RPC.
 */
import { supabase } from "@/src/supabase";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function err(e: any, fallback = "Request failed"): never {
  const msg = e?.message || e?.error_description || fallback;
  const status = e?.status || (e?.code === "PGRST116" ? 404 : 400);
  throw new ApiError(status, msg);
}

// --------- Auth helpers exposed for AuthContext ---------
export async function fetchMyProfile() {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess?.session?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", uid)
    .single();
  if (error) err(error, "Failed to load profile");
  return data;
}

// --------- CSV builder (replaces /export/*.csv) ---------
function csvOf(rows: any[][]): string {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

// =====================================================================
// Main shim
// =====================================================================
export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; raw?: boolean } = {},
): Promise<T> {
  const m = (opts.method || "GET").toUpperCase();
  const b = opts.body || {};

  // ============ AUTH ============
  if (path === "/auth/login" && m === "POST") {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(b.email).toLowerCase(),
      password: b.password,
    });
    if (error) err(error, "Incorrect email or password");
    const profile = await fetchMyProfile();
    if (profile?.status === "removed") {
      await supabase.auth.signOut();
      err({ status: 403, message: "Account deactivated" });
    }
    return { token: data.session?.access_token, user: profile } as any;
  }

  if (path === "/auth/register" && m === "POST") {
    // Custom RPC that creates an auto-confirmed user, bypassing GoTrue's mailer.
    const email = String(b.email).toLowerCase();
    const { error: rpcErr } = await supabase.rpc("public_signup", {
      p_name: b.name, p_email: email, p_password: b.password, p_phone: b.phone || "",
    });
    if (rpcErr) err(rpcErr, "Could not register");
    // Now sign in to obtain a session.
    const { data: sess, error: sErr } = await supabase.auth.signInWithPassword({
      email, password: b.password,
    });
    if (sErr) err(sErr, "Could not sign in after registration");
    const profile = await fetchMyProfile();
    return { token: sess.session?.access_token, user: profile } as any;
  }

  if (path === "/auth/me" && m === "GET") {
    const p = await fetchMyProfile();
    if (!p) err({ status: 401, message: "Not authenticated" });
    return p as any;
  }

  if (path === "/auth/profile" && m === "PUT") {
    const me = await fetchMyProfile();
    if (!me) err({ status: 401, message: "Not authenticated" });
    const updates: any = {};
    for (const k of [
      "name", "phone", "emergency_contact_name", "emergency_contact_phone", "medical_notes",
    ]) {
      if (b[k] !== undefined && b[k] !== null) updates[k] = b[k];
    }
    if (b.email) updates.email = String(b.email).toLowerCase();
    if (Object.keys(updates).length) {
      const { error } = await supabase.from("profiles").update(updates).eq("id", me.id);
      if (error) err(error);
    }
    // Email / password changes via Supabase Auth
    if (b.email || b.password) {
      const upd: any = {};
      if (b.email) upd.email = String(b.email).toLowerCase();
      if (b.password) upd.password = b.password;
      const { error } = await supabase.auth.updateUser(upd);
      if (error) err(error);
    }
    return (await fetchMyProfile()) as any;
  }

  if (path === "/auth/accept-waiver" && m === "POST") {
    const { data, error } = await supabase.rpc("accept_waiver", { p_version: b.version });
    if (error) err(error);
    return data as any;
  }

  if (path === "/auth/request-deletion" && m === "POST") {
    const { data, error } = await supabase.rpc("request_deletion");
    if (error) err(error);
    return data as any;
  }

  if (path === "/auth/request-password-reset" && m === "POST") {
    const { data, error } = await supabase.rpc("request_password_reset", {
      p_email: String(b.email).toLowerCase(),
    });
    if (error) err(error);
    return data as any;
  }

  if (path === "/auth/reset-password" && m === "POST") {
    const { data, error } = await supabase.rpc("reset_password", {
      p_token: b.token, p_new_password: b.password,
    });
    if (error) err(error);
    return data as any;
  }

  // ============ LEGAL / SETTINGS / PLANS / COACHES ============
  if (path === "/legal/waiver" && m === "GET") {
    const { data, error } = await supabase.rpc("legal_waiver");
    if (error) err(error);
    return data as any;
  }

  if (path === "/settings" && m === "GET") {
    const { data } = await supabase.from("settings").select("*").eq("id", "club").maybeSingle();
    return (data || {}) as any;
  }

  if (path === "/plans" && m === "GET") {
    const { data, error } = await supabase
      .from("plans").select("*").eq("archived", false).order("price");
    if (error) err(error);
    return (data || []) as any;
  }
  if (path === "/plans" && m === "POST") {
    const { data, error } = await supabase.from("plans").insert(b).select().single();
    if (error) err(error);
    return data as any;
  }
  const planM = path.match(/^\/plans\/([\w-]+)$/);
  if (planM && m === "PUT") {
    const { data, error } = await supabase.from("plans").update(b).eq("id", planM[1]).select().single();
    if (error) err(error);
    return data as any;
  }
  if (planM && m === "DELETE") {
    const { error } = await supabase.from("plans").update({ archived: true }).eq("id", planM[1]);
    if (error) err(error);
    return { ok: true } as any;
  }

  if (path === "/coaches" && m === "GET") {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,name,bio,photo,role")
      .in("role", ["coach", "admin"])
      .eq("status", "active");
    if (error) err(error);
    return (data || []) as any;
  }

  // ============ SCHEDULE / CLASSES / PUBLIC ============
  const schedM = path.match(/^\/schedule\?date=(.+)$/);
  if (schedM && m === "GET") {
    const { data, error } = await supabase.rpc("schedule_for_date", { p_date: schedM[1] });
    if (error) err(error);
    return (data || []) as any;
  }

  if (path === "/classes" && m === "GET") {
    const { data, error } = await supabase
      .from("classes")
      .select("*, coach:profiles!classes_coach_id_fkey(id,name,photo,bio)")
      .eq("archived", false);
    if (error) err(error);
    return (data || []) as any;
  }
  if (path === "/classes" && m === "POST") {
    const { data, error } = await supabase.from("classes").insert(b).select().single();
    if (error) err(error);
    return data as any;
  }
  const clsM = path.match(/^\/classes\/([\w-]+)$/);
  if (clsM && m === "PUT") {
    const { data, error } = await supabase.from("classes").update(b).eq("id", clsM[1]).select().single();
    if (error) err(error);
    return data as any;
  }
  if (clsM && m === "DELETE") {
    const { error } = await supabase.from("classes").update({ archived: true }).eq("id", clsM[1]);
    if (error) err(error);
    return { ok: true } as any;
  }
  const cancelDateM = path.match(/^\/classes\/([\w-]+)\/cancel-date$/);
  if (cancelDateM && m === "POST") {
    const { data, error } = await supabase.rpc("cancel_class_date", {
      p_class_id: cancelDateM[1], p_date: b.date, p_reason: b.reason || "Class cancelled",
    });
    if (error) err(error);
    return data as any;
  }
  const rosterM = path.match(/^\/classes\/([\w-]+)\/roster\?date=(.+)$/);
  if (rosterM && m === "GET") {
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("class_id", rosterM[1])
      .eq("date", rosterM[2])
      .in("status", ["booked", "waitlist", "attended", "no_show"])
      .order("created_at");
    if (error) err(error);
    return (data || []) as any;
  }
  const pubClsM = path.match(/^\/public\/classes\/([\w-]+)$/);
  if (pubClsM && m === "GET") {
    const { data, error } = await supabase.rpc("public_class_info", { p_class_id: pubClsM[1] });
    if (error) err(error);
    return data as any;
  }

  // ============ BOOKINGS ============
  if (path === "/bookings" && m === "POST") {
    const { data, error } = await supabase.rpc("book_class", {
      p_class_id: b.class_id, p_date: b.date,
    });
    if (error) err(error);
    return data as any;
  }
  const bkM = path.match(/^\/bookings\/([\w-]+)$/);
  if (bkM && m === "DELETE") {
    const { data, error } = await supabase.rpc("cancel_booking", { p_booking_id: bkM[1] });
    if (error) err(error);
    return data as any;
  }
  const bkCheckM = path.match(/^\/bookings\/([\w-]+)\/checkin$/);
  if (bkCheckM && m === "POST") {
    const { data, error } = await supabase.rpc("checkin_booking", {
      p_booking_id: bkCheckM[1], p_attended: !!b.attended,
    });
    if (error) err(error);
    return data as any;
  }
  if (path === "/bookings/me" && m === "GET") {
    const me = await fetchMyProfile();
    if (!me) err({ status: 401, message: "Not authenticated" });
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("user_id", me!.id)
      .order("date", { ascending: false })
      .order("start_time", { ascending: false });
    if (error) err(error);
    return (data || []) as any;
  }
  if (path === "/guest-bookings" && m === "POST") {
    const { data, error } = await supabase.rpc("guest_book_class", {
      p_class_id: b.class_id, p_date: b.date, p_name: b.name, p_email: b.email,
    });
    if (error) err(error);
    return data as any;
  }

  // ============ USERS (admin) ============
  if (path === "/users" && m === "GET") {
    const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    if (error) err(error);
    return (data || []) as any;
  }
  const userM = path.match(/^\/users\/([\w-]+)$/);
  if (userM && m === "GET") {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userM[1]).single();
    if (error) err(error, "User not found");
    return data as any;
  }
  if (userM && m === "PUT") {
    const updates: any = {};
    for (const k of [
      "name", "status", "role", "admin_notes", "bio", "photo", "permissions",
      "emergency_contact_name", "emergency_contact_phone", "medical_notes",
    ]) {
      if (b[k] !== undefined) updates[k] = b[k];
    }
    const { data, error } = await supabase.from("profiles").update(updates).eq("id", userM[1]).select().single();
    if (error) err(error);
    return data as any;
  }
  if (userM && m === "DELETE") {
    const { data, error } = await supabase.rpc("admin_delete_user", { p_user_id: userM[1] });
    if (error) err(error);
    return data as any;
  }
  const promoteM = path.match(/^\/users\/([\w-]+)\/promote-admin$/);
  if (promoteM && m === "POST") {
    const { data, error } = await supabase.rpc("promote_to_admin", { p_user_id: promoteM[1] });
    if (error) err(error);
    return data as any;
  }
  const promoteCoachM = path.match(/^\/users\/([\w-]+)\/promote-coach$/);
  if (promoteCoachM && m === "POST") {
    const { data, error } = await supabase.rpc("promote_to_coach", { p_user_id: promoteCoachM[1] });
    if (error) err(error);
    return data as any;
  }
  if (path === "/users/member" && m === "POST") {
    const { data, error } = await supabase.rpc("admin_create_member", {
      p_name: b.name, p_email: b.email, p_password: b.password || "",
      p_phone: b.phone || "", p_plan_id: b.plan_id || null, p_mark_paid: !!b.mark_paid,
    });
    if (error) err(error);
    return data as any;
  }
  if (path === "/users/coach" && m === "POST") {
    const { data, error } = await supabase.rpc("admin_create_coach", {
      p_name: b.name, p_email: b.email, p_password: b.password,
      p_bio: b.bio || "", p_photo: b.photo || "",
      p_permissions: b.permissions || {},
    });
    if (error) err(error);
    return data as any;
  }
  const attendM = path.match(/^\/users\/([\w-]+)\/attendance$/);
  if (attendM && m === "GET") {
    const { data, error } = await supabase
      .from("bookings").select("*").eq("user_id", attendM[1])
      .in("status", ["attended", "booked", "no_show"]).order("date", { ascending: false });
    if (error) err(error);
    return (data || []) as any;
  }

  // ============ SUBSCRIPTIONS / PAYMENTS ============
  if (path === "/subscriptions" && m === "POST") {
    const { data, error } = await supabase.rpc("create_subscription", {
      p_user_id: b.user_id, p_plan_id: b.plan_id,
      p_start_date: b.start_date || null, p_mark_paid: !!b.mark_paid,
    });
    if (error) err(error);
    return data as any;
  }
  const subActM = path.match(/^\/subscriptions\/([\w-]+)\/(mark-paid|freeze|resume)$/);
  if (subActM && m === "POST") {
    const fn = subActM[2] === "mark-paid" ? "mark_subscription_paid"
      : subActM[2] === "freeze" ? "freeze_subscription" : "resume_subscription";
    const { data, error } = await supabase.rpc(fn, { p_sub_id: subActM[1] });
    if (error) err(error);
    return data as any;
  }
  if (path === "/subscriptions/me" && m === "GET") {
    const me = await fetchMyProfile();
    if (!me) err({ status: 401, message: "Not authenticated" });
    const { data, error } = await supabase.from("subscriptions").select("*")
      .eq("user_id", me!.id).order("created_at", { ascending: false });
    if (error) err(error);
    return (data || []) as any;
  }
  const subListM = path.match(/^\/subscriptions(\?(.*))?$/);
  if (subListM && m === "GET") {
    const params = new URLSearchParams(subListM[2] || "");
    let q = supabase.from("subscriptions").select("*").order("end_date");
    if (params.get("user_id")) q = q.eq("user_id", params.get("user_id")!);
    if (params.get("expiring") === "true") {
      const soon = new Date(Date.now() + 7 * 86400 * 1000).toISOString().slice(0, 10);
      q = q.eq("status", "active").lte("end_date", soon);
    }
    const { data, error } = await q;
    if (error) err(error);
    return (data || []) as any;
  }
  if (path === "/payments/me" && m === "GET") {
    const me = await fetchMyProfile();
    if (!me) err({ status: 401, message: "Not authenticated" });
    const { data, error } = await supabase.from("payments").select("*")
      .eq("user_id", me!.id).order("created_at", { ascending: false });
    if (error) err(error);
    return (data || []) as any;
  }
  if (path === "/payments" && m === "GET") {
    const { data, error } = await supabase.from("payments").select("*").order("created_at", { ascending: false });
    if (error) err(error);
    return (data || []) as any;
  }
  const recM = path.match(/^\/payments\/([\w-]+)\/receipt$/);
  if (recM && m === "GET") {
    const { data, error } = await supabase.rpc("payment_receipt", { p_payment_id: recM[1] });
    if (error) err(error);
    return data as any;
  }

  // ============ PRIVATE SESSIONS ============
  if (path === "/private-sessions" && m === "POST") {
    const me = await fetchMyProfile();
    const coach = (await supabase.from("profiles").select("id,name").eq("id", b.coach_id).single()).data;
    if (!me || !coach) err({ status: 404, message: "Coach not found" });
    const { data, error } = await supabase.from("private_sessions").insert({
      member_id: me!.id, member_name: me!.name, coach_id: coach!.id, coach_name: coach!.name,
      date: b.date, time: b.time, notes: b.notes || "",
    }).select().single();
    if (error) err(error);
    return data as any;
  }
  if (path === "/private-sessions/me" && m === "GET") {
    const me = await fetchMyProfile();
    if (!me) err({ status: 401, message: "Not authenticated" });
    let q = supabase.from("private_sessions").select("*").order("date", { ascending: false });
    if (me!.role === "member") q = q.eq("member_id", me!.id);
    else if (me!.role === "coach") q = q.eq("coach_id", me!.id);
    const { data, error } = await q;
    if (error) err(error);
    return (data || []) as any;
  }
  const psM = path.match(/^\/private-sessions\/([\w-]+)$/);
  if (psM && m === "PUT") {
    const { data, error } = await supabase.from("private_sessions")
      .update({ status: b.status }).eq("id", psM[1]).select().single();
    if (error) err(error);
    return data as any;
  }

  // ============ ANNOUNCEMENTS / NOTIFICATIONS ============
  if (path === "/announcements" && m === "POST") {
    const { data, error } = await supabase.rpc("send_announcement", {
      p_title: b.title, p_body: b.body, p_audience: b.audience || "all", p_class_id: b.class_id || null,
    });
    if (error) err(error);
    return data as any;
  }
  if (path === "/announcements" && m === "GET") {
    const { data, error } = await supabase.from("announcements").select("*")
      .order("created_at", { ascending: false }).limit(20);
    if (error) err(error);
    return (data || []) as any;
  }
  if (path === "/notifications" && m === "GET") {
    const me = await fetchMyProfile();
    if (!me) return { items: [], unread: 0 } as any;
    const { data, error } = await supabase.from("notifications").select("*")
      .eq("user_id", me.id).order("created_at", { ascending: false }).limit(100);
    if (error) err(error);
    const items = data || [];
    return { items, unread: items.filter((i: any) => !i.read).length } as any;
  }
  if (path === "/notifications/read-all" && m === "POST") {
    const me = await fetchMyProfile();
    if (!me) return { ok: true } as any;
    const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", me.id);
    if (error) err(error);
    return { ok: true } as any;
  }

  // ============ ADMIN ============
  if (path === "/admin/dashboard" && m === "GET") {
    const { data, error } = await supabase.rpc("admin_dashboard");
    if (error) err(error);
    return data as any;
  }
  if (path === "/admin/settings" && m === "PUT") {
    const updates: any = {};
    for (const k of ["open_registration", "cancellation_window_hours", "private_session_policy", "club_email"]) {
      if (b[k] !== undefined && b[k] !== null) updates[k] = b[k];
    }
    const { error } = await supabase.from("settings").update(updates).eq("id", "club");
    if (error) err(error);
    const { data } = await supabase.from("settings").select("*").eq("id", "club").single();
    return data as any;
  }
  if (path === "/admin/media" && m === "POST") {
    // Read current, set media.<key> = image
    const cur = (await supabase.from("settings").select("media").eq("id", "club").single()).data;
    const media = { ...(cur?.media || {}), [b.key]: b.image };
    const { error } = await supabase.from("settings").update({ media }).eq("id", "club");
    if (error) err(error);
    return { ok: true } as any;
  }

  // ============ EXPORTS (build CSV client-side) ============
  if (path === "/export/members.csv" && m === "GET") {
    const { data, error } = await supabase.from("profiles").select("*").eq("role", "member");
    if (error) err(error);
    const header = ["Name", "Email", "Phone", "Status", "Waiver", "Joined", "Emergency Contact", "Emergency Phone"];
    const rows = [header, ...(data || []).map((u: any) => [
      u.name, u.email, u.phone || "", u.status,
      u.waiver_accepted ? `v${u.waiver_version}` : "no",
      (u.created_at || "").slice(0, 10),
      u.emergency_contact_name || "", u.emergency_contact_phone || "",
    ])];
    return csvOf(rows) as any;
  }
  if (path === "/export/payments.csv" && m === "GET") {
    const { data, error } = await supabase.from("payments").select("*").order("created_at", { ascending: false });
    if (error) err(error);
    const header = ["Receipt", "Date", "Member", "Plan", "Amount", "Method"];
    const rows = [header, ...(data || []).map((p: any) => [
      p.receipt_no, (p.created_at || "").slice(0, 10), p.user_name, p.plan_name, p.amount, p.method,
    ])];
    return csvOf(rows) as any;
  }

  throw new ApiError(404, `Unmapped api path: ${m} ${path}`);
}

// Token helpers kept for compatibility (Supabase manages session itself)
export async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}
export async function setToken(_t: string | null) { /* Supabase handles session */ }
