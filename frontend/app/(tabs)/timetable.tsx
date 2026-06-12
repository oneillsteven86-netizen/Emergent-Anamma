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
  const [date, setDate] = useState(days[0].date);
  const [classes, setClasses] = useState<any[]>([]);
  const [coaches, setCoaches] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState<string | null>(null);

  const canManage = user?.role === "admin" || user?.permissions?.manage_timetable;

  const load = useCallback(async (d: string) => {
    try {
      setClasses(await api(`/schedule?date=${d}`));
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(date);
      api("/coaches").then(setCoaches).catch(() => {});
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

  const openEdit = (c?: any) => {
    setForm(
      c
        ? { ...c }
        : { name: "", description: "", day_of_week: new Date(date + "T00:00:00").getDay() === 0 ? 6 : new Date(date + "T00:00:00").getDay() - 1, start_time: "18:00", duration_min: 60, room: "Main Mat", capacity: 20, coach_id: coaches[0]?.id },
    );
    setEditOpen(true);
  };

  const saveClass = async () => {
    if (!form.name || !form.start_time) return toast.show("Name and start time required", "error");
    try {
      const body = {
        name: form.name, description: form.description || "", day_of_week: Number(form.day_of_week),
        start_time: form.start_time, duration_min: Number(form.duration_min) || 60, room: form.room || "Main Mat",
        capacity: Number(form.capacity) || 20, coach_id: form.coach_id, image: form.image || "",
      };
      if (form.id) await api(`/classes/${form.id}`, { method: "PUT", body });
      else await api("/classes", { method: "POST", body });
      toast.show("Timetable updated");
      setEditOpen(false);
      load(date);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const cancelDate = async (c: any) => {
    try {
      const r = await api(`/classes/${c.id}/cancel-date`, { method: "POST", body: { date } });
      toast.show(`Class cancelled — ${r.notified} members notified`);
      setDetail(null);
      load(date);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const shareGuestLink = async (c: any) => {
    await Share.share({ message: `Book a free spot in ${c.name} at ANAM MMA: ${BASE_URL}/guest/${c.id}` });
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SP.md }]}>
        <Text style={styles.title}>TIMETABLE</Text>
        {canManage && (
          <Pressable testID="add-class-button" onPress={() => openEdit()} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="add-circle" size={24} color={C.brand} />
          </Pressable>
        )}
      </View>

      <View style={{ height: 76, justifyContent: "center", borderBottomWidth: 1, borderColor: C.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.lg }}>
          {days.map((d) => (
            <Pressable
              key={d.date}
              testID={`date-${d.date}`}
              onPress={() => setDate(d.date)}
              style={[styles.dateChip, date === d.date && styles.dateChipActive]}
            >
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: SP.sm }}>
                <Text style={styles.className}>{c.name}</Text>
                {c.cancelled && <Badge text="Cancelled" tone="error" />}
                {c.my_booking && <Badge text={c.my_booking.status === "waitlist" ? "Waitlist" : "Booked"} tone={c.my_booking.status === "waitlist" ? "warning" : "success"} />}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {c.coach?.photo ? <Image source={{ uri: c.coach.photo }} style={styles.coachPic} /> : null}
                <Text style={styles.meta}>
                  {c.coach?.name || "TBC"} • {c.room}
                </Text>
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

      {/* class detail sheet */}
      <Sheet visible={!!detail} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && (
          <View>
            <Text style={styles.meta}>
              {DAYS[detail.day_of_week]} • {detail.start_time} ({detail.duration_min} min) • {detail.room} • {detail.booked_count}/{detail.capacity} booked
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
                  <Btn small variant="outline" testID="edit-class-button" title="EDIT CLASS" onPress={() => { setDetail(null); openEdit(detail); }} />
                  {!detail.cancelled && (
                    <Btn small variant="danger" testID="cancel-class-date-button" title={`CANCEL THIS SESSION (${date})`} onPress={() => cancelDate(detail)} />
                  )}
                </>
              )}
            </View>
          </View>
        )}
      </Sheet>

      {/* edit/add class sheet */}
      <Sheet visible={editOpen} onClose={() => setEditOpen(false)} title={form.id ? "EDIT CLASS" : "ADD CLASS"}>
        <Input testID="class-name-input" label="Name" value={form.name} onChangeText={(v: string) => setForm({ ...form, name: v })} placeholder="e.g. K1 Kickboxing" />
        <Input testID="class-desc-input" label="Description" value={form.description} onChangeText={(v: string) => setForm({ ...form, description: v })} multiline style={{ height: 60, textAlignVertical: "top" }} />
        <Text style={styles.label}>DAY</Text>
        <View style={{ height: 56, justifyContent: "center" }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm }}>
            {DAYS.map((d, i) => (
              <Pressable key={d} testID={`day-${d}`} onPress={() => setForm({ ...form, day_of_week: i })} style={[styles.dayChip, form.day_of_week === i && { backgroundColor: C.brand, borderColor: C.brand }]}>
                <Text style={[styles.meta, form.day_of_week === i && { color: C.onBrand }]}>{d}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View style={{ flexDirection: "row", gap: SP.sm }}>
          <View style={{ flex: 1 }}>
            <Input testID="class-time-input" label="Start (HH:MM)" value={form.start_time} onChangeText={(v: string) => setForm({ ...form, start_time: v })} placeholder="18:00" />
          </View>
          <View style={{ flex: 1 }}>
            <Input testID="class-duration-input" label="Mins" value={String(form.duration_min ?? "")} onChangeText={(v: string) => setForm({ ...form, duration_min: v })} keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <Input testID="class-capacity-input" label="Capacity" value={String(form.capacity ?? "")} onChangeText={(v: string) => setForm({ ...form, capacity: v })} keyboardType="numeric" />
          </View>
        </View>
        <Input testID="class-room-input" label="Room" value={form.room} onChangeText={(v: string) => setForm({ ...form, room: v })} placeholder="Main Mat" />
        <Text style={styles.label}>COACH</Text>
        <View style={{ height: 56, justifyContent: "center" }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm }}>
            {coaches.map((co) => (
              <Pressable key={co.id} testID={`coach-pick-${co.id}`} onPress={() => setForm({ ...form, coach_id: co.id })} style={[styles.dayChip, form.coach_id === co.id && { backgroundColor: C.brand, borderColor: C.brand }]}>
                <Text style={[styles.meta, form.coach_id === co.id && { color: C.onBrand }]}>{co.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <Btn testID="save-class-button" title="SAVE CLASS" onPress={saveClass} style={{ marginTop: SP.sm }} />
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
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
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
  dayChip: {
    paddingHorizontal: SP.md, height: 36, borderRadius: R.pill, backgroundColor: C.surface3,
    borderWidth: 1, borderColor: C.border, justifyContent: "center", flexShrink: 0,
  },
});
