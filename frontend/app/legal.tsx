import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { C, SP, F } from "@/src/theme";

const TERMS = `ANAM MMA — TERMS OF SERVICE

1. Membership. Access to ANAM MMA facilities and classes requires a valid membership or class pack, or a confirmed guest booking. Memberships are personal and non-transferable.

2. Bookings. Class places are limited. Bookings may be cancelled by members up to the cancellation window set by the club. Repeated no-shows may result in booking restrictions.

3. Payments. Payments are accepted in cash at the club (and by card where enabled). Memberships renew per their stated duration. Fees are non-refundable except as required by law.

4. Conduct. Members must follow coach instructions, treat all members with respect, and adhere to club hygiene and safety rules. The club may suspend or terminate memberships for misconduct.

5. Health. You confirm you are physically fit to train and will disclose relevant medical conditions. Training carries inherent risk of injury — see the Liability Waiver.

6. Changes. The club may modify the timetable, coaches, and these terms. Material changes will be announced in-app.

Governed by the laws of Ireland.`;

const PRIVACY = `ANAM MMA — PRIVACY POLICY (GDPR)

ANAM MMA ("we") is the data controller for personal data processed through this app, operating in Ireland under EU GDPR.

What we collect: name, email, phone, emergency contact, optional medical notes, waiver acceptance records, booking and attendance history, payment records, and announcements engagement.

Why: to manage your membership (contract), to maintain legal records such as waiver acceptance (legal obligation/legitimate interest), to keep you safe during training (emergency contact, medical notes — processed with your explicit consent), and to communicate club updates.

Who can see it: club admin sees all member data. Coaches see emergency contact and medical notes for safety purposes only. We use SendGrid to deliver transactional emails. Data is stored securely and never sold.

Retention: data is retained for the duration of your membership plus any legally required period for waiver and payment records.

Your rights: access, rectification, erasure, restriction, portability and objection. You can request account/data deletion directly in the app (Profile → Request data deletion) or by contacting the club. You may lodge a complaint with the Irish Data Protection Commission (dataprotection.ie).`;

export default function Legal() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + SP.sm }]}>
      <View style={styles.header}>
        <Pressable testID="legal-back-button" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={C.onSurface} />
        </Pressable>
        <Text style={styles.title}>LEGAL</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: SP.xl, paddingBottom: insets.bottom + SP.xxl }}>
        <Text style={styles.section}>TERMS OF SERVICE</Text>
        <Text style={styles.body}>{TERMS}</Text>
        <Text style={[styles.section, { marginTop: SP.xxl }]}>PRIVACY POLICY</Text>
        <Text style={styles.body}>{PRIVACY}</Text>
      </ScrollView>
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
  section: { fontFamily: F.display, fontSize: 24, color: C.brand, letterSpacing: 1, marginBottom: SP.md },
  body: { fontFamily: F.body, fontSize: 14, color: C.onSurface2, lineHeight: 22 },
});
