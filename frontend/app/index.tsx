import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/src/context/AuthContext";
import { C } from "@/src/theme";

export default function Index() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.brand} size="large" />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;
  if (user.role === "member" && !user.waiver_accepted) return <Redirect href="/waiver" />;
  if (user.role === "admin") return <Redirect href="/(tabs)/dashboard" />;
  if (user.role === "coach") return <Redirect href="/(tabs)/coach" />;
  return <Redirect href="/(tabs)/home" />;
}
