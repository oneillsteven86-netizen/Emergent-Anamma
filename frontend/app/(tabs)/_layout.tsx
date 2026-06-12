import React from "react";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { C, F } from "@/src/theme";

export default function TabsLayout() {
  const { user } = useAuth();
  const role = user?.role || "member";

  const visible = {
    home: role === "member",
    coach: role === "coach",
    dashboard: role === "admin",
    members: role === "admin",
    timetable: true,
    bookings: role !== "admin",
    manage: role === "admin",
    profile: true,
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.brand,
        tabBarInactiveTintColor: "#6b6b6b",
        tabBarStyle: {
          backgroundColor: "#101010",
          borderTopColor: C.border,
          borderTopWidth: 1,
          height: Platform.OS === "ios" ? 88 : 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: F.bodyBold, fontSize: 10, letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          href: visible.home ? "/(tabs)/home" : null,
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          href: visible.coach ? "/(tabs)/coach" : null,
          title: "My Classes",
          tabBarIcon: ({ color, size }) => <Ionicons name="clipboard" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          href: visible.dashboard ? "/(tabs)/dashboard" : null,
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          href: visible.members ? "/(tabs)/members" : null,
          title: "Members",
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="timetable"
        options={{
          title: "Timetable",
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          href: visible.bookings ? "/(tabs)/bookings" : null,
          title: "Bookings",
          tabBarIcon: ({ color, size }) => <Ionicons name="bookmark" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="manage"
        options={{
          href: visible.manage ? "/(tabs)/manage" : null,
          title: "Manage",
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
