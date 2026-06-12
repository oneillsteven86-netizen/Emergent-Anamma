import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { Btn, Input, Card, useToast } from "@/src/components/UI";
import { C, SP, F, DAYS } from "@/src/theme";

export default function GuestBooking() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [cls, setCls] = useState<any>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<any>(null);

  useEffect(() => {
    api(`/public/classes/${classId}`).then(setCls).catch(() => {});
  }, [classId]);

  const book = async () => {
    if (!name || !email) {
      toast.show("Name and email are required", "error");
      return;
    }
    setLoading(true);
    try {
      const b = await api("/guest-bookings", {
        method: "POST",
        body: { class_id: classId, date: cls.next_date, name: name.trim(), email: email.trim() },
      });
      setDone(b);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + SP.xl }]}>
      <KeyboardAwareScrollView contentContainerStyle={{ padding: SP.xl, paddingBottom: insets.bottom + SP.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>
          ANAM <Text style={{ color: C.brand }}>MMA</Text>
        </Text>
        <Text style={styles.heading}>GUEST BOOKING</Text>
        {cls ? (
          <Card style={{ marginTop: SP.lg }}>
            <Text style={styles.className}>{cls.name}</Text>
            <Text style={styles.classMeta}>
              {DAYS[cls.day_of_week]} {cls.next_date} • {cls.start_time} • {cls.room}
            </Text>
            {cls.coach && <Text style={styles.classMeta}>Coach: {cls.coach.name}</Text>}
            {cls.description ? <Text style={styles.classDesc}>{cls.description}</Text> : null}
          </Card>
        ) : (
          <Text style={styles.classMeta}>Loading class…</Text>
        )}

        {done ? (
          <Card style={{ marginTop: SP.xl, alignItems: "center", gap: SP.sm }} testID="guest-booking-success">
            <Ionicons name="checkmark-circle" size={48} color={C.brand} />
            <Text style={styles.className}>
              {done.status === "waitlist" ? "You're on the waitlist!" : "You're booked in!"}
            </Text>
            <Text style={[styles.classMeta, { textAlign: "center" }]}>
              A confirmation email is on the way to {email}. Just turn up 10 minutes early — no account needed.
            </Text>
          </Card>
        ) : (
          <View style={{ marginTop: SP.xl }}>
            <Input testID="guest-name-input" label="Your name" value={name} onChangeText={setName} placeholder="Full name" autoCapitalize="words" />
            <Input
              testID="guest-email-input"
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@email.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Btn testID="guest-book-button" title="BOOK MY SPOT" onPress={book} loading={loading} disabled={!cls} />
          </View>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  logo: { fontFamily: F.display, fontSize: 30, color: C.onSurface, letterSpacing: 4 },
  heading: { fontFamily: F.display, fontSize: 20, color: C.onSurface3, letterSpacing: 2, marginTop: SP.xs },
  className: { fontFamily: F.display, fontSize: 24, color: C.onSurface, letterSpacing: 0.5 },
  classMeta: { fontFamily: F.body, fontSize: 13, color: C.onSurface3, marginTop: 4 },
  classDesc: { fontFamily: F.body, fontSize: 13, color: C.onSurface2, marginTop: SP.sm, lineHeight: 19 },
});
