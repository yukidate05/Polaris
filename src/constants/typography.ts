import { Platform } from 'react-native';

export const Typography = {
  // Font families
  fontFamily: {
    regular:  Platform.select({ ios: 'System', android: 'Roboto', default: 'System' }),
    medium:   Platform.select({ ios: 'System', android: 'Roboto-Medium', default: 'System' }),
    bold:     Platform.select({ ios: 'System', android: 'Roboto-Bold', default: 'System' }),
  },

  // Font weights
  fontWeight: {
    regular: '400' as const,
    medium:  '500' as const,
    semibold:'600' as const,
    bold:    '700' as const,
    heavy:   '800' as const,
  },

  // Font sizes
  fontSize: {
    xs:   11,
    sm:   13,
    base: 15,
    md:   17,
    lg:   20,
    xl:   24,
    '2xl':28,
    '3xl':34,
    '4xl':40,
  },

  // Line heights
  lineHeight: {
    tight:  1.2,
    normal: 1.5,
    relaxed:1.75,
  },
} as const;
