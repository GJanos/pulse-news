import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Modal,
  Linking,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AESTHETICS, THEMES, font } from '../themes';
import type { Theme, Aesthetic } from '../themes';
import { useAppStore } from '../store';
import RegionPicker from '../components/RegionPicker';
import Stepper from '../components/Stepper';
import PulseIcon from '../components/Icon';
import { globalHeadlineMax } from '../config';
import type { UserPreferences } from '../types';

interface Props {
  onLogout: () => void;
  onDeleteAccount: () => Promise<string | null>;
  embedded?: boolean;
}

export default function SettingsScreen({
  onLogout,
  onDeleteAccount,
  embedded = false,
}: Props): React.ReactElement {
  const insets = useSafeAreaInsets();
  const prefs = useAppStore((s) => s.prefs);
  const session = useAppStore((s) => s.session);
  const notificationsEnabled = useAppStore((s) => s.notificationsEnabled);
  const setPref = useAppStore((s) => s.setPref);
  const setScreen = useAppStore((s) => s.setScreen);

  const theme = THEMES[prefs.theme] ?? THEMES.light;
  const aes = AESTHETICS[prefs.aesthetic] ?? AESTHETICS.editorial;

  const handleBack = (): void => setScreen('digest');
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = (): void => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setDeleting(true);
            onDeleteAccount().then((err) => {
              setDeleting(false);
              if (err) Alert.alert('Error', err);
            });
          },
        },
      ],
    );
  };

  const email = session?.user?.email ?? '';

  return (
    <View
      style={
        embedded
          ? // embedded inside the pager, which already lives inside App's SafeAreaView
            { flex: 1, backgroundColor: theme.bg }
          : [
              StyleSheet.absoluteFill,
              {
                backgroundColor: theme.bg,
                zIndex: 50,
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
              },
            ]
      }
    >
      <View style={[s.header, { backgroundColor: theme.bg, borderBottomColor: theme.rule }]}>
        <Pressable
          onPress={handleBack}
          style={[s.backBtn, { backgroundColor: theme.chip }]}
          hitSlop={6}
          accessibilityLabel="Back"
        >
          <PulseIcon name="arrow-left" size={16} color={theme.text} />
        </Pressable>
        <Text
          style={{
            fontFamily: font(aes, 'title', 700),
            fontSize: 22,
            lineHeight: 26,
            letterSpacing: -0.3,
            color: theme.text,
            flex: 1,
            marginLeft: 8,
          }}
        >
          Settings
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Group theme={theme} aes={aes} label="Account">
          <Row
            theme={theme}
            aes={aes}
            label="Signed in as"
            value={
              <Text style={{ fontFamily: font(aes, 'number'), color: theme.textDim, fontSize: 13 }}>
                {email}
              </Text>
            }
          />
        </Group>

        <Group theme={theme} aes={aes} label="Notification">
          {!notificationsEnabled && (
            <Pressable
              onPress={() => void Linking.openSettings()}
              style={[s.row, { borderBottomColor: theme.rule }]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{ fontFamily: font(aes, 'ui', 500), fontSize: 14.5, color: theme.accent }}
                >
                  Notifications disabled
                </Text>
                <Text
                  style={{
                    fontFamily: font(aes, 'body'),
                    fontSize: 12,
                    color: theme.textFaint,
                    marginTop: 2,
                  }}
                >
                  Tap to open system settings
                </Text>
              </View>
              <PulseIcon name="arrow-right" size={16} color={theme.textFaint} />
            </Pressable>
          )}
          <Row
            theme={theme}
            aes={aes}
            label="Daily digest time"
            sub="One push a day, no more."
            value={
              <NotifyTimePicker
                theme={theme}
                aes={aes}
                value={prefs.notifyTime}
                onChange={(v) => setPref('notifyTime', v)}
              />
            }
          />
        </Group>

        <Group theme={theme} aes={aes} label="Global Headlines">
          <Row
            theme={theme}
            aes={aes}
            label="Show global headlines"
            sub="Top stories from across all regions, selected by global importance."
            value={
              <Switch
                value={prefs.showGlobalHeadlines}
                onValueChange={(v) => setPref('showGlobalHeadlines', v)}
                trackColor={{ false: theme.chip, true: theme.accent }}
                thumbColor={theme.bg}
              />
            }
          />
          <Row
            theme={theme}
            aes={aes}
            label="Count"
            sub="Number of global headlines shown."
            value={
              <Gated enabled={prefs.showGlobalHeadlines}>
                <Stepper
                  theme={theme}
                  aes={aes}
                  value={prefs.globalHeadlineCount}
                  min={1}
                  max={globalHeadlineMax}
                  icons
                  onChange={(v) => setPref('globalHeadlineCount', v)}
                />
              </Gated>
            }
          />
        </Group>

        <RegionPicker />

        <Group theme={theme} aes={aes} label="Reading">
          <Row
            theme={theme}
            aes={aes}
            label="Local history"
            sub="Days of digests kept on this device."
            value={
              <Stepper
                theme={theme}
                aes={aes}
                value={prefs.historyDays}
                min={3}
                max={30}
                suffix="d"
                onChange={(v) => setPref('historyDays', v)}
              />
            }
          />
          <Row
            theme={theme}
            aes={aes}
            label="Open links in"
            value={
              <SegRow<UserPreferences['openLinksIn']>
                theme={theme}
                aes={aes}
                value={prefs.openLinksIn}
                options={[
                  { value: 'in-app', label: 'In-app' },
                  { value: 'browser', label: 'Browser' },
                ]}
                onChange={(v) => setPref('openLinksIn', v)}
              />
            }
          />
        </Group>

        <Group theme={theme} aes={aes} label="Images">
          <Row
            theme={theme}
            aes={aes}
            label="Show photos"
            sub="Lead + thumbnail on the top stories per region."
            value={
              <Switch
                value={prefs.imagesEnabled}
                onValueChange={(v) => setPref('imagesEnabled', v)}
                trackColor={{ false: theme.chip, true: theme.accent }}
                thumbColor={theme.bg}
                accessibilityLabel="Show photos"
              />
            }
          />
          <Row
            theme={theme}
            aes={aes}
            label="Photos per region"
            sub={'Max stories per region that show a photo.\n1 = lead only.'}
            value={
              <Gated enabled={prefs.imagesEnabled}>
                <Stepper
                  theme={theme}
                  aes={aes}
                  value={prefs.photoCount}
                  min={1}
                  max={3}
                  icons
                  onChange={(v) => setPref('photoCount', v)}
                />
              </Gated>
            }
          />
        </Group>

        <Group theme={theme} aes={aes} label="Display">
          <Row
            theme={theme}
            aes={aes}
            label="Theme"
            value={
              <SegRow<UserPreferences['theme']>
                theme={theme}
                aes={aes}
                value={prefs.theme}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'sepia', label: 'Sepia' },
                  { value: 'dark', label: 'Dark' },
                ]}
                onChange={(v) => setPref('theme', v)}
              />
            }
          />
          <Row
            theme={theme}
            aes={aes}
            label="Font"
            value={
              <SegRow<UserPreferences['aesthetic']>
                theme={theme}
                aes={aes}
                value={prefs.aesthetic}
                options={[
                  { value: 'editorial', label: 'Serif' },
                  { value: 'clinical', label: 'Sans' },
                  { value: 'brutalist', label: 'Mono' },
                ]}
                onChange={(v) => setPref('aesthetic', v)}
              />
            }
          />
          <Row
            theme={theme}
            aes={aes}
            label="Region label"
            value={
              <SegRow<UserPreferences['regionStyle']>
                theme={theme}
                aes={aes}
                value={prefs.regionStyle}
                options={[
                  { value: 'flag', label: 'Flag' },
                  { value: 'code', label: 'Code' },
                ]}
                onChange={(v) => setPref('regionStyle', v)}
              />
            }
          />
          <Row
            theme={theme}
            aes={aes}
            label="Currency rates"
            sub="Show rate and daily % change per region."
            value={
              <Switch
                value={prefs.showCurrencyRates}
                onValueChange={(v) => setPref('showCurrencyRates', v)}
                trackColor={{ false: theme.chip, true: theme.accent }}
                thumbColor={theme.bg}
              />
            }
          />
          <Row
            theme={theme}
            aes={aes}
            label="Base currency"
            sub="Rates displayed relative to this currency."
            value={
              <CurrencyPicker
                theme={theme}
                aes={aes}
                value={prefs.baseCurrency}
                onChange={(v) => setPref('baseCurrency', v)}
                disabled={!prefs.showCurrencyRates}
              />
            }
          />
        </Group>

        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <Pressable
            onPress={onLogout}
            accessibilityLabel="Sign out"
            style={({ pressed }) => [
              s.logout,
              { borderColor: theme.rule, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <PulseIcon name="logout" size={15} color={theme.text} />
            <Text
              style={{
                fontFamily: font(aes, 'ui', 600),
                fontSize: 14.5,
                color: theme.text,
                marginLeft: 8,
              }}
            >
              Sign out
            </Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 12, alignItems: 'center' }}>
          <Pressable
            onPress={confirmDelete}
            disabled={deleting}
            style={({ pressed }) => ({
              opacity: deleting || pressed ? 0.55 : 1,
              paddingVertical: 10,
            })}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#c0392b" />
            ) : (
              <Text style={{ fontFamily: font(aes, 'ui', 500), fontSize: 13, color: '#c0392b' }}>
                Delete account
              </Text>
            )}
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 16, alignItems: 'center' }}>
          <Text
            style={{
              fontFamily: font(aes, 'eyebrow', 500),
              fontSize: 10,
              letterSpacing: 2,
              lineHeight: 18,
              color: theme.textFaint,
              textTransform: 'uppercase',
              textAlign: 'center',
            }}
          >
            Pulse News · v1.0{'\n'}one notification · one tap · move on
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Gated ─────────────────────────────────────────────────────────────────────

function Gated({
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

// ── Building blocks ──────────────────────────────────────────────────────────

interface GroupProps {
  theme: Theme;
  aes: Aesthetic;
  label: string;
  children: React.ReactNode;
}

function Group({ theme, aes, label, children }: GroupProps): React.ReactElement {
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

interface RowProps {
  theme: Theme;
  aes: Aesthetic;
  label: string;
  sub?: string;
  value: React.ReactNode;
}

function Row({ theme, aes, label, sub, value }: RowProps): React.ReactElement {
  return (
    <View style={[s.row, { borderBottomColor: theme.rule }]}>
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
function NotifyTimePicker({
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

const POPULAR_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'] as const;

interface CurrencyPickerProps {
  theme: Theme;
  aes: Aesthetic;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

/** Chip showing the base currency; opens a bottom-sheet list. No-op while disabled. */
function CurrencyPicker({
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

function SegRow<V extends string>({
  theme,
  aes,
  value,
  options,
  onChange,
}: SegRowProps<V>): React.ReactElement {
  return (
    <View style={[s.seg, { backgroundColor: theme.chip }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[s.segBtn, { backgroundColor: on ? theme.surface : 'transparent' }]}
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

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  logout: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seg: { flexDirection: 'row', padding: 2, borderRadius: 9 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7 },
});
