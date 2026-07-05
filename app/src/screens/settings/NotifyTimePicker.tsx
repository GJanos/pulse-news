import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal } from 'react-native';
import { font } from '../../themes';
import type { Theme, Aesthetic } from '../../themes';
import PulseIcon from '../../components/Icon';

const TIME_OPTS: string[] = [];
for (let hr = 6; hr <= 22; hr++) {
  for (const m of [0, 30]) {
    TIME_OPTS.push(`${String(hr).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}
const TIME_ITEM_HEIGHT = 45;

interface NotifyTimePickerProps {
  theme: Theme;
  aes: Aesthetic;
  value: string;
  onChange: (v: string) => void;
}

/** Chip showing the daily digest time; opens a bottom-sheet list of 30-min slots. */
export function NotifyTimePicker({
  theme,
  aes,
  value,
  onChange,
}: NotifyTimePickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!open) return;
    const i = TIME_OPTS.indexOf(value);
    if (i <= 2) return;
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: (i - 2) * TIME_ITEM_HEIGHT, animated: false });
    }, 50);
    return () => clearTimeout(id);
  }, [open, value]);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: theme.chip,
          borderRadius: 10,
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
              maxHeight: '60%',
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
            <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}>
              {TIME_OPTS.map((time) => {
                const sel = time === value;
                return (
                  <Pressable
                    key={time}
                    onPress={() => {
                      onChange(time);
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
                      {time}
                    </Text>
                    {sel && (
                      <PulseIcon name="check" size={16} color={theme.accent} strokeWidth={2.2} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
