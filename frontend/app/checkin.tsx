import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { Btn, EmptyState, Badge, useToast } from "@/src/components/UI";
import { C, SP, R, F } from "@/src/theme";

export default function CheckIn() {
  const { classId, date, name } = useLocalSearchParams<{ classId: string; date: string; name: string }>();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [roster, setRoster] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api(`/classes/${classId}/roster?date=${date}`);
      setRoster(r);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [classId, date]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (b: any) => {
    const attended = b.status !== "attended";
    setRoster((prev) => prev.map((x) => (x.id === b.id ? { ...x, status: attended ? "attended" : "booked" } : x)));
    try {
      await api(`/bookings/${b.id}/checkin`, { method: "POST", body: { attended } });
    } catch (e: any) {
      toast.show(e.message, "error");
      load();
    }
  };

  const filtered = roster.filter((b) => b.user_name.toLowerCase().includes(search.toLowerCase()));
  const attendedCount = roster.filter((b) => b.status === "attended").length;

  return (
    <View style={[styles.container, { paddingTop: insets.top + SP.sm }]}>
      <View style={styles.header}>
        <Pressable testID="checkin-back-button" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={C.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.title}>{name || "CHECK-IN"}</Text>
          <Text style={styles.sub}>
            {date} • {attendedCount}/{roster.length} checked in
          </Text>
        </View>
        <View style={{ width: 26 }} />
      </View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={C.onSurface3} />
        <TextInput
          testID="checkin-search-input"
          style={styles.search}
          placeholder="Find member…"
          placeholderTextColor={C.onSurface3}
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: SP.lg, paddingBottom: insets.bottom + SP.xl }}
        ListEmptyComponent={
          loading ? null : <EmptyState icon="people-outline" text="No members booked for this class yet." />
        }
        renderItem={({ item }) => (
          <View style={styles.row} testID={`roster-row-${item.id}`}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.user_name?.charAt(0)?.toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{item.user_name}</Text>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                {item.guest && <Badge text="Guest" tone="gold" />}
                {item.status === "waitlist" && <Badge text="Waitlist" tone="warning" />}
              </View>
            </View>
            {item.status !== "waitlist" && (
              <Btn
                testID={`checkin-toggle-${item.id}`}
                small
                title={item.status === "attended" ? "✓ IN" : "CHECK IN"}
                variant={item.status === "attended" ? "primary" : "outline"}
                onPress={() => toggle(item)}
              />
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: SP.lg, paddingVertical: SP.md,
    borderBottomWidth: 1, borderColor: C.border,
  },
  title: { fontFamily: F.display, fontSize: 20, color: C.onSurface, letterSpacing: 1, textTransform: "uppercase" },
  sub: { fontFamily: F.body, fontSize: 12, color: C.onSurface3, marginTop: 2 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: SP.sm, backgroundColor: C.surface2,
    margin: SP.lg, marginBottom: 0, borderRadius: R.md, borderWidth: 1, borderColor: C.border, paddingHorizontal: SP.md,
  },
  search: { flex: 1, color: C.onSurface, fontFamily: F.body, paddingVertical: 12, fontSize: 14 },
  row: {
    flexDirection: "row", alignItems: "center", gap: SP.md, backgroundColor: C.surface2,
    borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: SP.md, marginBottom: SP.sm,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.brandTint, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: F.display, fontSize: 18, color: C.onBrandTint },
  rowName: { fontFamily: F.bodyBold, fontSize: 15, color: C.onSurface },
});
