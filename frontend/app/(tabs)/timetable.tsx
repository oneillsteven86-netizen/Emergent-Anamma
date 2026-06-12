import React, { useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, FlatList, Pressable, Share, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import { Btn, Input, EmptyState, CapacityBar, Sheet, useToast, Badge } from "@/src/components/UI";
import { C, SP, R, F, DAYS } from "@/src/theme";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIME_SLOTS = Array.from({ length: 32 }, (_, i) => {
  const h = Math.floor(i / 2) + 6;
  return `${String(h).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
});
const DURATIONS = [30, 45, 60, 75, 90, 120];

function next14Days() {
  const out: { date: string; day: string; num: string }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, day: DAYS[(d.getDay() + 6) % 7], num: iso.slice(8) });
  }
  return out;
}

export default function Timetable() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const days = useMemo(next14Days, []);
  const canManage = user?.role === "admin" || user?.permissions?.manage_timetable;

  const [view, setView] = useState<"day" | "week">(canManage ? "week" : "day");
  const [date, setDate] = useState(days[0].date);
  const [classes, setClasses] = useState<any[]>([]);
  const [weekClasses, setWeekClasses] = useState<any[]>([]);
  const [coaches, setCoaches] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    try {
      const [sched, all, co] = await Promise.all([api(`/schedule?date=${d}`), api("/classes"), api("/coaches")]);
      setClasses(sched);
      setWeekClasses(all);
      setCoaches(co);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [date, load]),
  );

  const book = async (c: any) => {
    setBusy(c.id);
    try {
      const b = await api("/bookings", { method: "POST", body: { class_id: c.id, date } });
      toast.show(b.status === "waitlist" ? "Added to waitlist" : "Booked! See you on the mats 🥊");
      load(date);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (c: any) => {
    setBusy(c.id);
    try {
      await api(`/bookings/${c.my_booking.id}`, { method: "DELETE" });
      toast.show("Booking cancelled");
      load(date);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const openEdit = (c?: any, dayIdx?: number) => {
    setDetail(null);
    setForm(
      c
        ? { ...c }
        : {
            name: "", description: "", day_of_week: dayIdx ?? 0, start_time: "18:00",
            duration_min: 60, room: "Main Mat", capacity: 20, coach_id: coaches[0]?.id,
          },
    );
    setEditOpen(true);
  };

  const saveClass = async () => {
    if (!form.name) return toast.show("Class name required", "error");
    try {
      const body = {
        name: form.name, description: form.description || "", day_of_week: Number(form.day_of_week),
        start_time: form.start_time, duration_min: Number(form.duration_min) || 60, room: form.room || "Main Mat",
        capacity: Number(form.capacity) || 20, coach_id: form.coach_id, image: form.image || "",
      };
      if (form.id) await api(`/classes/${form.id}`, { method: "PUT", body });
      else await api("/classes", { method: "POST", body });
      toast.show(form.id ? "Class updated" : "Class added to timetable");
      setEditOpen(false);
      load(date);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const cancelDate = async (c: any) => {
    try {
      const r = await api(`/classes/${c.id}/cancel-date`, { method: "POST", body: { date } });
      toast.show(`Session cancelled — ${r.notified} members notified`);
      setDetail(null);
      load(date);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const shareGuestLink = async (c: any) => {
    await Share.share({ message: `Book a free spot in ${c.name} at ANAM MMA: ${BASE_URL}/guest/${c.id}` });
  };

  // ---------- DAY VIEW ----------
  const DayView = () => (
    <>
      <View style={{ height: 76, justifyContent: "center", borderBottomWidth: 1, borderColor: C.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.lg }}>
          {days.map((d) => (
            <Pressable key={d.date} testID={`date-${d.date}`} onPress={() => setDate(d.date)} style={[styles.dateChip, date === d.date && styles.dateChipActive]}>
              <Text style={[styles.dateDay, date === d.date && { color: C.onBrand }]}>{d.day}</Text>
              <Text style={[styles.dateNum, date === d.date && { color: C.onBrand }]}>{d.num}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={classes}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.brand} onRefresh={async () => { setRefreshing(true); await load(date); setRefreshing(false); }} />}
        ListEmptyComponent={<EmptyState text="No classes scheduled for this date." />}
        renderItem={({ item: c }) => (
          <Pressable testID={`class-card-${c.id}`} style={[styles.card, c.cancelled && { opacity: 0.55 }]} onPress={() => setDetail(c)}>
            <View style={styles.cardLeft}>
              <Text style={styles.time}>{c.start_time}</Text>
              <Text style={styles.dur}>{c.duration_min}m</Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: SP.sm, flexWrap: "wrap" }}>
                <Text style={styles.className}>{c.name}</Text>
                {c.cancelled && <Badge text="Cancelled" tone="error" />}
                {c.my_booking && <Badge text={c.my_booking.status === "waitlist" ? "Waitlist" : "Booked"} tone={c.my_booking.status === "waitlist" ? "warning" : "success"} />}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {c.coach?.photo ? <Image source={{ uri: c.coach.photo }} style={styles.coachPic} /> : null}
                <Text style={styles.meta}>{c.coach?.name || "TBC"} • {c.room}</Text>
              </View>
              <CapacityBar booked={c.booked_count} capacity={c.capacity} />
            </View>
            {!c.cancelled && user?.role === "member" && (
              <Btn
                small
                testID={`book-btn-${c.id}`}
                loading={busy === c.id}
                title={c.my_booking ? "CANCEL" : c.booked_count >= c.capacity ? "WAITLIST" : "BOOK"}
                variant={c.my_booking ? "outline" : "primary"}
                onPress={() => (c.my_booking ? cancel(c) : book(c))}
              />
            )}
          </Pressable>
        )}
      />
    </>
  );

  // ---------- WEEK VIEW (concise overview, admin-friendly) ----------
  const WeekView = () => {
    const grouped = FULL_DAYS.map((label, i) => ({
      label, idx: i,
      items: weekClasses.filter((c) => c.day_of_week === i).sort((a, b) => a.start_time.localeCompare(b.start_time)),
    }));
    return (
      <ScrollView
        contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.brand} onRefresh={async () => { setRefreshing(true); await load(date); setRefreshing(false); }} />}
      >
        {grouped.map((g) => (
          <View key={g.label} style={{ marginBottom: SP.lg }}>
            <View style={styles.weekDayRow}>
              <Text style={styles.weekDay}>{g.label.toUpperCase()}</Text>
              {canManage && (
                <Pressable testID={`add-class-${g.label.toLowerCase()}`} onPress={() => openEdit(undefined, g.idx)} hitSlop={10} style={styles.weekAdd}>
                  <Ionicons name="add" size={18} color={C.brand} />
                  <Text style={styles.weekAddText}>ADD</Text>
                </Pressable>
              )}
            </View>
            {g.items.length === 0 ? (
              <Text style={styles.weekEmpty}>Rest day — no classes</Text>
            ) : (
              g.items.map((c) => (
                <Pressable key={c.id} testID={`week-class-${c.id}`} style={styles.weekRow} onPress={() => (canManage ? openEdit(c) : setDetail({ ...c, booked_count: 0, waitlist_count: 0 }))}>
                  <Text style={styles.weekTime}>{c.start_time}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.weekName}>{c.name}</Text>
                    <Text style={styles.meta}>{c.coach?.name || "TBC"} • {c.room} • cap {c.capacity}</Text>
                  </View>
                  {canManage && <Ionicons name="pencil" size={16} color={C.onSurface3} />}
                </Pressable>
              ))
            )}
          </View>
        ))}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <Text style={styles.title}>TIMETABLE</Text>
        <View style={styles.viewToggle}>
          <Pressable testID="view-day" onPress={() => setView("day")} style={[styles.viewBtn, view === "day" && styles.viewBtnActive]}>
            <Text style={[styles.viewText, view === "day" && { color: C.onBrand }]}>DAY</Text>
          </Pressable>
          <Pressable testID="view-week" onPress={() => setView("week")} style={[styles.viewBtn, view === "week" && styles.viewBtnActive]}>
            <Text style={[styles.viewText, view === "week" && { color: C.onBrand }]}>WEEK</Text>
          </Pressable>
        </View>
      </View>

      {view === "day" ? <DayView /> : <WeekView />}

      {/* class detail sheet (day view / member week view) */}
      <Sheet visible={!!detail} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && (
          <View>
            <Text style={styles.meta}>
              {FULL_DAYS[detail.day_of_week]} • {detail.start_time} ({detail.duration_min} min) • {detail.room}
              {detail.date ? ` • ${detail.booked_count}/${detail.capacity} booked` : ` • cap ${detail.capacity}`}
              {detail.waitlist_count ? ` • ${detail.waitlist_count} waitlisted` : ""}
            </Text>
            {detail.description ? <Text style={styles.desc}>{detail.description}</Text> : null}
            {detail.coach && (
              <View style={styles.coachCard}>
                {detail.coach.photo ? <Image source={{ uri: detail.coach.photo }} style={styles.coachBig} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={styles.coachName}>{detail.coach.name}</Text>
                  <Text style={styles.meta}>{detail.coach.bio}</Text>
                </View>
              </View>
            )}
            <View style={{ gap: SP.sm, marginTop: SP.lg }}>
              <Btn small variant="outline" testID="share-guest-link-button" title="SHARE GUEST BOOKING LINK" onPress={() => shareGuestLink(detail)} />
              {canManage && (
                <>
                  <Btn small variant="outline" testID="edit-class-button" title="EDIT CLASS" onPress={() => openEdit(detail)} />
                  {!detail.cancelled && detail.date && (
                    <Btn small variant="danger" testID="cancel-class-date-button" title={`CANCEL THIS SESSION (${date})`} onPress={() => cancelDate(detail)} />
                  )}
                </>
              )}
            </View>
          </View>
        )}
      </Sheet>

      {/* add/edit class — tap-based pickers, no typing needed for time/duration/capacity */}
      <Sheet visible={editOpen} onClose={() => setEditOpen(false)} title={form.id ? "EDIT CLASS" : `ADD CLASS — ${FULL_DAYS[form.day_of_week ?? 0]?.toUpperCase() || ""}`}>
        <Input testID="class-name-input" label="Class name" value={form.name} onChangeText={(v: string) => setForm({ ...form, name: v })} placeholder="e.g. K1 Kickboxing" />

        <Text style={styles.label}>DAY</Text>
        <View style={{ height: 48, justifyContent: "center", marginBottom: SP.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm }}>
            {DAYS.map((d, i) => (
              <Pressable key={d} testID={`day-${d}`} onPress={() => setForm({ ...form, day_of_week: i })} style={[styles.pickChip, form.day_of_week === i && styles.pickChipActive]}>
                <Text style={[styles.pickText, form.day_of_week === i && { color: C.onBrand }]}>{d}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <Text style={styles.label}>START TIME</Text>
        <View style={{ height: 48, justifyContent: "center", marginBottom: SP.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm }}>
            {TIME_SLOTS.map((t) => (
              <Pressable key={t} testID={`time-${t}`} onPress={() => setForm({ ...form, start_time: t })} style={[styles.pickChip, form.start_time === t && styles.pickChipActive]}>
                <Text style={[styles.pickText, form.start_time === t && { color: C.onBrand }]}>{t}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <Text style={styles.label}>DURATION</Text>
        <View style={{ flexDirection: "row", gap: SP.sm, marginBottom: SP.md, flexWrap: "wrap" }}>
          {DURATIONS.map((d) => (
            <Pressable key={d} testID={`duration-${d}`} onPress={() => setForm({ ...form, duration_min: d })} style={[styles.pickChip, Number(form.duration_min) === d && styles.pickChipActive]}>
              <Text style={[styles.pickText, Number(form.duration_min) === d && { color: C.onBrand }]}>{d}m</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SP.md }}>
          <Text style={styles.label}>CAPACITY</Text>
          <View style={styles.stepper}>
            <Pressable testID="capacity-minus" onPress={() => setForm({ ...form, capacity: Math.max(1, Number(form.capacity || 20) - 2) })} style={styles.stepBtn} hitSlop={6}>
              <Ionicons name="remove" size={20} color={C.onSurface} />
            </Pressable>
            <Text style={styles.stepVal}>{form.capacity ?? 20}</Text>
            <Pressable testID="capacity-plus" onPress={() => setForm({ ...form, capacity: Number(form.capacity || 20) + 2 })} style={styles.stepBtn} hitSlop={6}>
              <Ionicons name="add" size={20} color={C.onSurface} />
            </Pressable>
          </View>
        </View>

        <Input testID="class-room-input" label="Room" value={form.room} onChangeText={(v: string) => setForm({ ...form, room: v })} placeholder="Main Mat" />

        <Text style={styles.label}>COACH</Text>
        <View style={{ height: 48, justifyContent: "center", marginBottom: SP.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm }}>
            {coaches.map((co) => (
              <Pressable key={co.id} testID={`coach-pick-${co.id}`} onPress={() => setForm({ ...form, coach_id: co.id })} style={[styles.pickChip, form.coach_id === co.id && styles.pickChipActive]}>
                <Text style={[styles.pickText, form.coach_id === co.id && { color: C.onBrand }]}>{co.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <Input testID="class-desc-input" label="Description (optional)" value={form.description} onChangeText={(v: string) => setForm({ ...form, description: v })} multiline style={{ height: 56, textAlignVertical: "top" }} />

        <Btn testID="save-class-button" title={form.id ? "SAVE CHANGES" : "ADD TO TIMETABLE"} onPress={saveClass} />
        {form.id && (
          <Btn
            testID="delete-class-button"
            title="DELETE CLASS"
            variant="danger"
            style={{ marginTop: SP.sm }}
            onPress={async () => {
              await api(`/classes/${form.id}`, { method: "DELETE" });
              toast.show("Class removed from timetable");
              setEditOpen(false);
              load(date);
            }}
          />
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SP.lg, paddingBottom: SP.md, borderBottomWidth: 1, borderColor: C.border,
  },
  title: { fontFamily: F.display, fontSize: 26, color: C.onSurface, letterSpacing: 1 },
  viewToggle: { flexDirection: "row", backgroundColor: C.surface2, borderRadius: R.pill, borderWidth: 1, borderColor: C.border, padding: 3 },
  viewBtn: { paddingHorizontal: SP.lg, paddingVertical: 7, borderRadius: R.pill },
  viewBtnActive: { backgroundColor: C.brand },
  viewText: { fontFamily: F.bodyBold, fontSize: 12, color: C.onSurface3, letterSpacing: 1 },
  dateChip: {
    width: 52, height: 56, borderRadius: R.md, backgroundColor: C.surface2, borderWidth: 1,
    borderColor: C.border, alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  dateChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  dateDay: { fontFamily: F.body, fontSize: 10, color: C.onSurface3, letterSpacing: 1 },
  dateNum: { fontFamily: F.display, fontSize: 20, color: C.onSurface },
  card: {
    flexDirection: "row", gap: SP.md, backgroundColor: C.surface2, borderRadius: R.lg,
    borderWidth: 1, borderColor: C.border, padding: SP.lg, marginBottom: SP.sm, alignItems: "center",
  },
  cardLeft: { alignItems: "center", width: 52 },
  time: { fontFamily: F.display, fontSize: 22, color: C.brand },
  dur: { fontFamily: F.body, fontSize: 11, color: C.onSurface3 },
  className: { fontFamily: F.display, fontSize: 19, color: C.onSurface, letterSpacing: 0.4 },
  meta: { fontFamily: F.body, fontSize: 12, color: C.onSurface3 },
  desc: { fontFamily: F.body, fontSize: 13, color: C.onSurface2, marginTop: SP.sm, lineHeight: 19 },
  coachPic: { width: 18, height: 18, borderRadius: 9 },
  coachCard: { flexDirection: "row", gap: SP.md, marginTop: SP.lg, backgroundColor: C.surface3, borderRadius: R.md, padding: SP.md, alignItems: "center" },
  coachBig: { width: 56, height: 56, borderRadius: 28 },
  coachName: { fontFamily: F.bodyBold, fontSize: 15, color: C.onSurface, marginBottom: 2 },
  label: { color: C.onSurface3, fontFamily: F.bodyBold, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 },
  // week view
  weekDayRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SP.sm },
  weekDay: { fontFamily: F.display, fontSize: 18, color: C.brand, letterSpacing: 1.2 },
  weekAdd: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: SP.sm, height: 32, justifyContent: "center" },
  weekAddText: { fontFamily: F.bodyBold, fontSize: 12, color: C.brand, letterSpacing: 0.8 },
  weekEmpty: { fontFamily: F.body, fontSize: 12, color: C.onSurface3, opacity: 0.6, paddingVertical: 4 },
  weekRow: {
    flexDirection: "row", alignItems: "center", gap: SP.md, backgroundColor: C.surface2,
    borderRadius: R.md, borderWidth: 1, borderColor: C.border, paddingHorizontal: SP.md, paddingVertical: 10, marginBottom: 6,
  },
  weekTime: { fontFamily: F.display, fontSize: 17, color: C.brand, width: 48 },
  weekName: { fontFamily: F.bodyBold, fontSize: 14, color: C.onSurface },
  // pickers
  pickChip: {
    paddingHorizontal: SP.md, height: 36, borderRadius: R.pill, backgroundColor: C.surface3,
    borderWidth: 1, borderColor: C.border, justifyContent: "center", flexShrink: 0,
  },
  pickChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  pickText: { fontFamily: F.bodyBold, fontSize: 13, color: C.onSurface2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: SP.md, backgroundColor: C.surface3, borderRadius: R.pill, padding: 4 },
  stepBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2, alignItems: "center", justifyContent: "center" },
  stepVal: { fontFamily: F.display, fontSize: 20, color: C.onSurface, minWidth: 32, textAlign: "center" },
});
