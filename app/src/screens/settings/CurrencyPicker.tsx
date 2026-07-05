import React, { useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { font } from '../../themes';
import type { Theme, Aesthetic } from '../../themes';
import PulseIcon from '../../components/Icon';

const POPULAR_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'] as const;

interface CurrencyPickerProps {
  theme: Theme;
  aes: Aesthetic;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

/** Chip showing the base currency; opens a bottom-sheet list. No-op while disabled. */
export function CurrencyPicker({
  theme,
  aes,
  value,
  onChange,
  disabled = false,
}: CurrencyPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: theme.chip,
          borderRadius: 10,
          opacity: disabled ? 0.35 : 1,
        }}
      >
        <Text
          style={{
            fontFamily: font(aes, 'number'),
            fontSize: 14,
            color: theme.text,
            letterSpacing: 0.1,
          }}
        >
          {value}
        </Text>
        <View style={{ marginLeft: 6 }}>
          <PulseIcon name="chevron-down" size={12} color={theme.textFaint} strokeWidth={2} />
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
          onPress={() => setOpen(false)}
        >
          <Pressable
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              paddingTop: 12,
              paddingBottom: 36,
            }}
            onPress={() => {}}
          >
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.rule,
                alignSelf: 'center',
                marginBottom: 8,
              }}
            />
            {POPULAR_CURRENCIES.map((c) => {
              const sel = c === value;
              return (
                <Pressable
                  key={c}
                  onPress={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 28,
                    paddingVertical: 14,
                    backgroundColor: pressed || sel ? theme.chip : 'transparent',
                  })}
                >
                  <Text
                    style={{
                      fontFamily: font(aes, 'number'),
                      fontSize: 17,
                      color: sel ? theme.accent : theme.text,
                    }}
                  >
                    {c}
                  </Text>
                  {sel && (
                    <PulseIcon name="check" size={16} color={theme.accent} strokeWidth={2.2} />
                  )}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
