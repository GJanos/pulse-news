import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation } from 'react-native';
import { font, THEMES, AESTHETICS } from '../themes';
import type { Theme } from '../themes';
import { REGIONS } from '../data';
import { config } from '../config';
import { useAppStore } from '../store';
import PulseIcon from './Icon';
import Flag from './Flag';
import Stepper from './Stepper';

type Region = (typeof REGIONS)[number];
type Mode = 'normal' | 'reorder' | 'tune';

const LAYOUT_ANIM = { duration: 180, update: { type: 'easeInEaseOut' as const } };

export default function RegionPicker(): React.ReactElement {
  const selectedRegions = useAppStore((s) => s.prefs.selectedRegions);
  const headlineCount = useAppStore((s) => s.prefs.headlineCount);
  const regionHeadlineCounts = useAppStore((s) => s.prefs.regionHeadlineCounts);
  const setPref = useAppStore((s) => s.setPref);
  const themeId = useAppStore((s) => s.prefs.theme);
  const aesId = useAppStore((s) => s.prefs.aesthetic);
  const theme = THEMES[themeId] ?? THEMES.light;
  const aes = AESTHETICS[aesId] ?? AESTHETICS.editorial;

  const [mode, setMode] = useState<Mode>('normal');

  const [orderedRegions, setOrderedRegions] = useState<Region[]>(() => {
    const selectedSet = new Set(selectedRegions);
    const selectedInOrder = selectedRegions
      .map((name) => REGIONS.find((r) => r.region === name))
      .filter(Boolean) as Region[];
    const unselected = REGIONS.filter((r) => !selectedSet.has(r.region));
    return [...selectedInOrder, ...unselected];
  });

  const selected = useMemo(() => new Set(selectedRegions), [selectedRegions]);
  const allSelected = selected.size === REGIONS.length;

  useEffect(() => {
    const selectedSet = new Set(selectedRegions);
    const nextOrder = [
      ...(selectedRegions
        .map(
          (name) =>
            orderedRegions.find((r) => r.region === name) ?? REGIONS.find((r) => r.region === name),
        )
        .filter(Boolean) as Region[]),
      ...orderedRegions.filter((r) => !selectedSet.has(r.region)),
    ];
    if (
      nextOrder.length === orderedRegions.length &&
      nextOrder.every((r, i) => r.region === orderedRegions[i]?.region)
    )
      return;
    setOrderedRegions(nextOrder);
  }, [selectedRegions]); // intentionally omitting orderedRegions to avoid infinite loop

  const commit = (nextSelected: Set<string>, order: Region[] = orderedRegions): void => {
    setPref(
      'selectedRegions',
      order.filter((r) => nextSelected.has(r.region)).map((r) => r.region),
    );
  };

  const toggleRegion = (name: string): void => {
    const next = new Set(selected);
    if (next.has(name)) {
      if (next.size === 1) return; // must keep at least one region selected
      next.delete(name);
    } else {
      next.add(name);
    }
    const nextOrder = [
      ...orderedRegions.filter((r) => next.has(r.region)),
      ...orderedRegions.filter((r) => !next.has(r.region)),
    ];
    LayoutAnimation.configureNext(LAYOUT_ANIM);
    setOrderedRegions(nextOrder);
    commit(next, nextOrder);
  };

  const moveRegion = (name: string, dir: 'up' | 'down'): void => {
    if (!selected.has(name)) return;
    const idx = orderedRegions.findIndex((r) => r.region === name);
    const to = dir === 'up' ? idx - 1 : idx + 1;
    if (to < 0 || to >= selected.size) return;
    const next = [...orderedRegions];
    [next[idx], next[to]] = [next[to]!, next[idx]!];
    LayoutAnimation.configureNext(LAYOUT_ANIM);
    setOrderedRegions(next);
    commit(selected, next);
  };

  const jumpRegion = (name: string, dir: 'up' | 'down'): void => {
    if (!selected.has(name)) return;
    const idx = orderedRegions.findIndex((r) => r.region === name);
    if (idx === -1) return;
    if (dir === 'up' ? idx === 0 : idx === selected.size - 1) return;
    const next = [...orderedRegions];
    const [item] = next.splice(idx, 1);
    if (dir === 'up') next.unshift(item!);
    else next.splice(selected.size - 1, 0, item!);
    LayoutAnimation.configureNext(LAYOUT_ANIM);
    setOrderedRegions(next);
    commit(selected, next);
  };

  const leftPill =
    mode === 'reorder'
      ? {
          label: allSelected ? 'None' : 'All',
          onPress: () => {
            LayoutAnimation.configureNext(LAYOUT_ANIM);
            if (!allSelected) {
              commit(new Set(REGIONS.map((r) => r.region)));
              return;
            }
            // "None" keeps a single region — the digest must never go empty.
            const first = orderedRegions[0]?.region;
            if (first) commit(new Set([first]));
          },
          active: false,
        }
      : mode === 'tune'
        ? { label: 'Done', onPress: () => setMode('normal'), active: true }
        : { label: 'Tune', onPress: () => setMode('tune'), active: false };

  const rightPill =
    mode === 'tune'
      ? { label: 'Reset', onPress: () => setPref('regionHeadlineCounts', {}), active: false }
      : mode === 'reorder'
        ? { label: 'Done', onPress: () => setMode('normal'), active: true }
        : { label: 'Reorder', onPress: () => setMode('reorder'), active: false };

  return (
    <View style={{ marginBottom: 24 }}>
      <View style={s.groupHead}>
        <Text
          style={{
            fontFamily: font(aes, 'eyebrow', 600),
            fontSize: 10,
            letterSpacing: 1.8,
            color: theme.textFaint,
            textTransform: 'uppercase',
          }}
        >
          Regions
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            style={{
              fontFamily: font(aes, 'number'),
              fontSize: 10.5,
              color: theme.textFaint,
              letterSpacing: 0.4,
            }}
          >
            {selected.size} of {REGIONS.length}
          </Text>
          <Pressable
            onPress={leftPill.onPress}
            style={[
              s.pill,
              {
                backgroundColor: leftPill.active ? theme.accent : theme.accentSoft,
                marginLeft: 10,
              },
            ]}
            accessibilityLabel={leftPill.label}
          >
            <Text
              style={{
                fontFamily: font(aes, 'ui', 600),
                fontSize: 11,
                letterSpacing: 0.4,
                color: leftPill.active ? theme.bg : theme.accent,
              }}
            >
              {leftPill.label}
            </Text>
          </Pressable>
          <Pressable
            onPress={rightPill.onPress}
            style={[
              s.pill,
              {
                backgroundColor: rightPill.active ? theme.accent : theme.accentSoft,
                marginLeft: 10,
              },
            ]}
            accessibilityLabel={rightPill.label}
          >
            <Text
              style={{
                fontFamily: font(aes, 'ui', 600),
                fontSize: 11,
                letterSpacing: 0.4,
                color: rightPill.active ? theme.bg : theme.accent,
              }}
            >
              {rightPill.label}
            </Text>
          </Pressable>
        </View>
      </View>

      <View
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: theme.rule,
          backgroundColor: theme.surface,
        }}
      >
        <View
          style={[
            s.regionRow,
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.rule },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: font(aes, 'ui', 500),
                fontSize: 14.5,
                color: theme.text,
                letterSpacing: -0.05,
              }}
            >
              Headlines per region
            </Text>
            <Text
              style={{
                fontFamily: font(aes, 'body'),
                fontSize: 12,
                color: theme.textFaint,
                lineHeight: 16,
                marginTop: 2,
              }}
            >
              Default for all regions. Override via Tune.
            </Text>
          </View>
          <Stepper
            icons
            theme={theme}
            aes={aes}
            value={headlineCount}
            min={1}
            max={config.fetchCount}
            onChange={(n) => setPref('headlineCount', n)}
          />
        </View>
        {orderedRegions.map((r, i) => {
          const isSelected = selected.has(r.region);
          const count = regionHeadlineCounts[r.region] ?? headlineCount;
          return (
            <Pressable
              key={r.region}
              onPress={() => mode !== 'tune' && toggleRegion(r.region)}
              accessibilityLabel={`${r.region}, ${isSelected ? 'selected' : 'not selected'}`}
              style={({ pressed }) => [
                s.regionRow,
                {
                  borderBottomColor: theme.rule,
                  borderBottomWidth: i < orderedRegions.length - 1 ? StyleSheet.hairlineWidth : 0,
                  backgroundColor:
                    pressed && mode !== 'tune'
                      ? theme.chip
                      : isSelected
                        ? theme.surface
                        : 'transparent',
                },
              ]}
            >
              <Flag country={r.country} width={26} height={20} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text
                  style={{
                    fontFamily: font(aes, 'body', 500),
                    fontSize: 15,
                    color: isSelected ? theme.text : theme.textDim,
                  }}
                >
                  {r.region}
                </Text>
                <Text
                  style={{
                    fontFamily: font(aes, 'eyebrow', 500),
                    fontSize: 9,
                    letterSpacing: 1.3,
                    color: theme.textFaint,
                    textTransform: 'uppercase',
                    marginTop: 2,
                  }}
                >
                  {r.continent}
                </Text>
              </View>
              {isSelected && mode === 'reorder' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
                  <Pressable
                    onPress={() => moveRegion(r.region, 'up')}
                    onLongPress={() => jumpRegion(r.region, 'up')}
                    hitSlop={4}
                    style={({ pressed }) => [
                      s.reorderBtn,
                      {
                        backgroundColor: pressed ? theme.accentSoft : theme.chip,
                        opacity: i === 0 ? 0.35 : 1,
                      },
                    ]}
                    accessibilityLabel={`Move ${r.region} up`}
                  >
                    <PulseIcon name="chevron-up" size={20} color={theme.text} strokeWidth={2.2} />
                  </Pressable>
                  <Pressable
                    onPress={() => moveRegion(r.region, 'down')}
                    onLongPress={() => jumpRegion(r.region, 'down')}
                    hitSlop={4}
                    style={({ pressed }) => [
                      s.reorderBtn,
                      {
                        backgroundColor: pressed ? theme.accentSoft : theme.chip,
                        opacity: i === selected.size - 1 ? 0.35 : 1,
                        marginLeft: 8,
                      },
                    ]}
                    accessibilityLabel={`Move ${r.region} down`}
                  >
                    <PulseIcon name="chevron-down" size={20} color={theme.text} strokeWidth={2.2} />
                  </Pressable>
                </View>
              ) : isSelected && mode === 'tune' ? (
                <View style={{ marginRight: 8 }}>
                  <Stepper
                    icons
                    theme={theme}
                    aes={aes}
                    value={count}
                    min={1}
                    max={config.fetchCount}
                    onChange={(n) =>
                      setPref('regionHeadlineCounts', { ...regionHeadlineCounts, [r.region]: n })
                    }
                    valueColor={
                      regionHeadlineCounts[r.region] != null ? theme.accent : theme.textFaint
                    }
                  />
                </View>
              ) : (
                <Text
                  style={{
                    fontFamily: font(aes, 'number', 600),
                    fontSize: 10,
                    color: isSelected ? theme.accent : theme.textFaint,
                    letterSpacing: 0.5,
                    marginRight: 8,
                  }}
                >
                  {r.code}
                </Text>
              )}
              {mode !== 'tune' && <Checkmark on={isSelected} theme={theme} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Checkmark({ on, theme }: { on: boolean; theme: Theme }): React.ReactElement {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: on ? theme.text : 'transparent',
        borderWidth: on ? 0 : 1.5,
        borderColor: theme.rule,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? <PulseIcon name="check" size={13} color={theme.bg} strokeWidth={2.4} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  groupHead: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  regionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  reorderBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
