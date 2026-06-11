import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import PulseIcon from './Icon';
import { THEMES, AESTHETICS, font } from '../themes';
import { useAppStore } from '../store';
import { isoDateAtDayIndex } from '../data';
import { monthGrid, addMonths, sameMonth, monthLabel } from '../utils/calendar';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  todayISO: string;
  /** Oldest browsable day-index (`maxDayIndexFor(historyDays)`). */
  maxDayIndex: number;
  /** Currently shown day-index, highlighted in the grid. */
  selectedDayIndex: number;
  onSelectDay: (dayIndex: number) => void;
}

/**
 * Month-grid picker over the local digest history. Only dates within
 * [today − maxDayIndex, today] are tappable; older months are reachable
 * with the chevrons as far as the history window extends.
 */
export default function CalendarModal({
  open,
  onClose,
  todayISO,
  maxDayIndex,
  selectedDayIndex,
  onSelectDay,
}: Props): React.ReactElement {
  const theme = useAppStore((s) => THEMES[s.prefs.theme]);
  const aes = useAppStore((s) => AESTHETICS[s.prefs.aesthetic]);

  const [monthISO, setMonthISO] = useState(todayISO);
  // Re-anchor to the current month each time the sheet opens.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setMonthISO(todayISO);
  }

  const oldestISO = isoDateAtDayIndex(maxDayIndex, todayISO);
  const selectedISO = isoDateAtDayIndex(selectedDayIndex, todayISO);
  const weeks = useMemo(
    () => monthGrid(monthISO, todayISO, maxDayIndex),
    [monthISO, todayISO, maxDayIndex],
  );
  const canGoOlder = !sameMonth(monthISO, oldestISO);
  const canGoNewer = !sameMonth(monthISO, todayISO);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} testID="calendar-backdrop">
        <Pressable
          style={[s.panel, { backgroundColor: theme.surface, borderColor: theme.rule }]}
          onPress={() => {}}
        >
          <View style={s.monthRow}>
            <Pressable
              onPress={() => canGoOlder && setMonthISO(addMonths(monthISO, -1))}
              hitSlop={8}
              accessibilityLabel="Older month"
              style={{ opacity: canGoOlder ? 1 : 0.25 }}
            >
              <PulseIcon name="arrow-left" size={16} color={theme.textDim} />
            </Pressable>
            <Text
              style={{
                fontFamily: font(aes, 'title', 600),
                fontSize: 16,
                color: theme.text,
                letterSpacing: -0.2,
              }}
            >
              {monthLabel(monthISO)}
            </Text>
            <Pressable
              onPress={() => canGoNewer && setMonthISO(addMonths(monthISO, 1))}
              hitSlop={8}
              accessibilityLabel="Newer month"
              style={{ opacity: canGoNewer ? 1 : 0.25 }}
            >
              <PulseIcon name="arrow-right" size={16} color={theme.textDim} />
            </Pressable>
          </View>

          <View style={s.weekRow}>
            {WEEKDAYS.map((d, i) => (
              <View key={`${d}-${i}`} style={s.cell}>
                <Text
                  style={{
                    fontFamily: font(aes, 'eyebrow', 600),
                    fontSize: 10,
                    letterSpacing: 1,
                    color: theme.textFaint,
                  }}
                >
                  {d}
                </Text>
              </View>
            ))}
          </View>

          {weeks.map((week, wi) => (
            <View key={wi} style={s.weekRow}>
              {week.map((cell, ci) => {
                if (!cell) return <View key={ci} style={s.cell} />;
                const enabled = cell.dayIndex !== null;
                const isSelected = cell.iso === selectedISO;
                const isToday = cell.iso === todayISO;
                return (
                  <Pressable
                    key={cell.iso}
                    disabled={!enabled}
                    onPress={() => {
                      onSelectDay(cell.dayIndex!);
                      onClose();
                    }}
                    accessibilityLabel={cell.iso}
                    style={[
                      s.cell,
                      s.dayCell,
                      isSelected && { backgroundColor: theme.accent },
                      !isSelected && isToday && { backgroundColor: theme.accentSoft },
                    ]}
                  >
                    <Text
                      style={{
                        fontFamily: font(aes, 'number', isSelected ? 600 : 400),
                        fontSize: 14,
                        color: isSelected
                          ? theme.bg
                          : enabled
                            ? isToday
                              ? theme.accent
                              : theme.text
                            : theme.textFaint,
                        opacity: enabled ? 1 : 0.45,
                      }}
                    >
                      {cell.day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  weekRow: { flexDirection: 'row' },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  dayCell: { borderRadius: 10, minHeight: 38 },
});
