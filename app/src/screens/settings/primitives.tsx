import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { font } from '../../themes';
import type { Theme, Aesthetic } from '../../themes';

// ── Gated ─────────────────────────────────────────────────────────────────────

/** Dims and disables interaction with its children when `enabled` is false. */
export function Gated({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View pointerEvents={enabled ? 'auto' : 'none'} style={{ opacity: enabled ? 1 : 0.35 }}>
      {children}
    </View>
  );
}

// ── Group ────────────────────────────────────────────────────────────────────

interface GroupProps {
  theme: Theme;
  aes: Aesthetic;
  label: string;
  children: React.ReactNode;
}

/** Titled, hairline-bordered card wrapping a set of rows. */
export function Group({ theme, aes, label, children }: GroupProps): React.ReactElement {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={settingsStyles.groupHead}>
        <Text
          style={{
            fontFamily: font(aes, 'eyebrow', 600),
            fontSize: 10,
            letterSpacing: 1.8,
            color: theme.textFaint,
            textTransform: 'uppercase',
          }}
        >
          {label}
        </Text>
      </View>
      <View
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: theme.rule,
          backgroundColor: theme.surface,
        }}
      >
        {children}
      </View>
    </View>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

interface RowProps {
  theme: Theme;
  aes: Aesthetic;
  label: string;
  sub?: string;
  value: React.ReactNode;
}

/** Label (+ optional sub-line) on the left, a control on the right. */
export function Row({ theme, aes, label, sub, value }: RowProps): React.ReactElement {
  return (
    <View style={[settingsStyles.row, { borderBottomColor: theme.rule }]}>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: font(aes, 'ui', 500),
            fontSize: 14.5,
            color: theme.text,
            letterSpacing: -0.05,
          }}
        >
          {label}
        </Text>
        {sub ? (
          <Text
            style={{
              fontFamily: font(aes, 'body'),
              fontSize: 12,
              color: theme.textFaint,
              lineHeight: 16,
              marginTop: 2,
            }}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      <View>{value}</View>
    </View>
  );
}

// ── SegRow ───────────────────────────────────────────────────────────────────

interface SegOption<V extends string> {
  value: V;
  label: string;
}
interface SegRowProps<V extends string> {
  theme: Theme;
  aes: Aesthetic;
  value: V;
  options: SegOption<V>[];
  onChange: (v: V) => void;
}

/** Segmented single-select control. */
export function SegRow<V extends string>({
  theme,
  aes,
  value,
  options,
  onChange,
}: SegRowProps<V>): React.ReactElement {
  return (
    <View style={[settingsStyles.seg, { backgroundColor: theme.chip }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[settingsStyles.segBtn, { backgroundColor: on ? theme.surface : 'transparent' }]}
          >
            <Text
              style={{
                fontFamily: font(aes, 'ui', on ? 600 : 500),
                fontSize: 12.5,
                letterSpacing: -0.05,
                color: on ? theme.text : theme.textDim,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const settingsStyles = StyleSheet.create({
  groupHead: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seg: { flexDirection: 'row', padding: 2, borderRadius: 9 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7 },
});
