import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { EmptyState } from "@/src/components/UI";
import { C, SP, R, F } from "@/src/theme";

const ICONS: Record<string, any> = {
  booking: "calendar", waitlist: "trending-up", membership: "card", payment: "cash",
  announcement: "megaphone", class: "alert-circle", approval: "checkmark-circle",
  signup: "person-add", private: "person", gdpr: "shield", admin: "shield", role: "key", general: "notifications",
};

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api("/notifications");
      setItems(res.items);
      await api("/notifications/read-all", { method: "POST" });
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + SP.sm }]}>
      <View style={styles.header}>
        <Pressable testID="notifications-back-button" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={C.onSurface} />
        </Pressable>
        <Text style={styles.title}>NOTIFICATIONS</Text>
        <View style={{ width: 26 }} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: SP.lg, paddingBottom: insets.bottom + SP.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={C.brand}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={<EmptyState icon="notifications-off-outline" text="No notifications yet." />}
        renderItem={({ item }) => (
          <View style={[styles.row, !item.read && styles.unread]} testID={`notification-${item.id}`}>
            <View style={styles.iconWrap}>
              <Ionicons name={ICONS[item.type] || "notifications"} size={18} color={C.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowBody}>{item.body}</Text>
              <Text style={styles.rowDate}>{new Date(item.created_at).toLocaleString()}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SP.lg, paddingVertical: SP.md, borderBottomWidth: 1, borderColor: C.border,
  },
  title: { fontFamily: F.display, fontSize: 22, color: C.onSurface, letterSpacing: 1.5 },
  row: {
    flexDirection: "row", gap: SP.md, backgroundColor: C.surface2, borderRadius: R.md,
    borderWidth: 1, borderColor: C.border, padding: SP.lg, marginBottom: SP.sm,
  },
  unread: { borderColor: C.brandDark },
  iconWrap: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.brandTint,
    alignItems: "center", justifyContent: "center",
  },
  rowTitle: { fontFamily: F.bodyBold, fontSize: 14, color: C.onSurface },
  rowBody: { fontFamily: F.body, fontSize: 13, color: C.onSurface3, marginTop: 2, lineHeight: 19 },
  rowDate: { fontFamily: F.body, fontSize: 11, color: C.onSurface3, marginTop: 6, opacity: 0.7 },
});
