import { Redirect, Tabs } from 'expo-router';
import { useAuthStore } from '@stores/authStore';

export default function TabsLayout() {
  const { user, isInitialized } = useAuthStore();

  if (isInitialized && !user) {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  return (
    <Tabs
      tabBar={() => null}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home"     />
      <Tabs.Screen name="radio"    />
      <Tabs.Screen name="memory"   />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
