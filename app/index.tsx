import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@stores/authStore';
import { Colors } from '@constants/colors';

export default function Index() {
  const { user, isInitialized } = useAuthStore();

  if (!isInitialized) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.brand.primary} />
      </View>
    );
  }

  if (user) {
    return <Redirect href="/(tabs)/home" />;
  }

  return <Redirect href="/(onboarding)/welcome" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background.primary,
  },
});
