import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

// react-native-purchases requires a native binary — not available in Expo Go
const isNativeBuild = Constants.appOwnership !== 'expo';

function getPurchases() {
  if (!isNativeBuild) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-purchases') as typeof import('react-native-purchases');
}

export function initRevenueCat(userId?: string) {
  const pkg = getPurchases();
  if (!pkg) return;

  const apiKey = Platform.select({
    ios:     process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '',
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '',
    default: '',
  });
  if (!apiKey) return;

  if (__DEV__) {
    pkg.default.setLogLevel(pkg.LOG_LEVEL.DEBUG);
  }
  pkg.default.configure({ apiKey });
  if (userId) {
    pkg.default.logIn(userId);
  }
}

export async function getOfferings() {
  const pkg = getPurchases();
  if (!pkg) return null;
  try {
    return await pkg.default.getOfferings();
  } catch {
    return null;
  }
}

export async function purchasePackage(purchase: PurchasesPackage) {
  const pkg = getPurchases();
  if (!pkg) throw new Error('RevenueCat not available in Expo Go');
  return pkg.default.purchasePackage(purchase);
}

export async function restorePurchases() {
  const pkg = getPurchases();
  if (!pkg) throw new Error('RevenueCat not available in Expo Go');
  return pkg.default.restorePurchases();
}
