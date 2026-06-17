import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import zxcvbn from 'zxcvbn';
import { font, type Aesthetic, type Theme } from '../themes';
import PulseMark from '../components/PulseMark';
import PulseIcon from '../components/Icon';
import type { SignUpResult } from '../hooks/useSupabaseAuth';

const STRENGTH_COLORS = ['#c0392b', '#e67e22', '#d4a017', '#27ae60', '#27ae60'] as const;
const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;

interface Props {
  theme: Theme;
  aes: Aesthetic;
  onSignIn: (email: string, pw: string) => Promise<string | null>;
  onSignUp: (email: string, pw: string) => Promise<SignUpResult>;
  onResetPassword: (email: string) => Promise<string | null>;
}

export default function LoginScreen({
  theme,
  aes,
  onSignIn,
  onSignUp,
  onResetPassword,
}: Props): React.ReactElement {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');

  return (
    <KeyboardAvoidingView
      // Android: rely on the manifest's adjustResize instead of 'height' — the
      // 'height' behavior fights adjustResize and leaves an uncovered strip at the
      // bottom that reveals the native window background (theme-mismatched band).
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.bg }}
    >
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.brand}>
          <PulseMark size={52} color={theme.text} accent={theme.accent} />
          <View style={s.wordmark}>
            <Text
              style={{
                fontFamily: font(aes, 'title', 700),
                fontSize: 36,
                letterSpacing: -1,
                color: theme.text,
                lineHeight: 36,
              }}
            >
              Pulse
            </Text>
            <Text
              style={{
                fontFamily: font(aes, 'eyebrow', 600),
                fontSize: 10,
                letterSpacing: 2,
                color: theme.accent,
                textTransform: 'uppercase',
                marginLeft: 8,
                lineHeight: 10,
              }}
            >
              News
            </Text>
          </View>
          <Text
            style={{
              fontFamily: font(aes, 'body'),
              fontSize: 14.5,
              lineHeight: 22,
              color: theme.textDim,
              marginTop: 10,
              maxWidth: 280,
              textAlign: 'center',
            }}
          >
            {mode === 'signup'
              ? 'One quiet digest, once a day. Pick your regions on the next screen.'
              : 'One quiet digest, once a day. Sign in to read today’s headlines.'}
          </Text>
        </View>

        <View style={[s.toggle, { backgroundColor: theme.surface, borderColor: theme.rule }]}>
          <Pressable
            onPress={() => setMode('signin')}
            style={[s.toggleBtn, mode === 'signin' && { backgroundColor: theme.bg }]}
          >
            <Text
              style={{
                fontFamily: font(aes, 'ui', 500),
                fontSize: 13,
                color: mode === 'signin' ? theme.text : theme.textDim,
              }}
            >
              Sign in
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('signup')}
            style={[s.toggleBtn, mode === 'signup' && { backgroundColor: theme.bg }]}
          >
            <Text
              style={{
                fontFamily: font(aes, 'ui', 500),
                fontSize: 13,
                color: mode === 'signup' ? theme.text : theme.textDim,
              }}
            >
              Create account
            </Text>
          </Pressable>
        </View>

        {mode === 'signin' ? (
          <SignInForm
            theme={theme}
            aes={aes}
            email={email}
            onEmailChange={setEmail}
            onSignIn={onSignIn}
            onResetPassword={onResetPassword}
          />
        ) : (
          <SignUpForm
            theme={theme}
            aes={aes}
            email={email}
            onEmailChange={setEmail}
            onSignUp={onSignUp}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface SignInFormProps {
  theme: Theme;
  aes: Aesthetic;
  email: string;
  onEmailChange: (v: string) => void;
  onSignIn: (email: string, pw: string) => Promise<string | null>;
  onResetPassword: (email: string) => Promise<string | null>;
}

function SignInForm({
  theme,
  aes,
  email,
  onEmailChange,
  onSignIn,
  onResetPassword,
}: SignInFormProps): React.ReactElement {
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsInfo, setMessageIsInfo] = useState(false);

  const showError = (msg: string) => {
    setMessage(msg);
    setMessageIsInfo(false);
  };
  const showInfo = (msg: string) => {
    setMessage(msg);
    setMessageIsInfo(true);
  };

  const valid = email.includes('@') && pw.length >= 6;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setMessage(null);
    const err = await onSignIn(email, pw);
    setBusy(false);
    if (err) showError(err);
  };

  const handleReset = async () => {
    if (!email.includes('@')) {
      showError('Enter your email above first.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const err = await onResetPassword(email);
    setBusy(false);
    if (err) showError(err);
    else showInfo('Reset link sent — check your email.');
  };

  return (
    <View style={s.form}>
      <FieldRow
        theme={theme}
        aes={aes}
        icon="mail"
        value={email}
        onChange={onEmailChange}
        placeholder="email"
        keyboardType="email-address"
      />
      <View style={{ marginTop: 12 }}>
        <FieldRow
          theme={theme}
          aes={aes}
          icon="lock"
          value={pw}
          onChange={setPw}
          placeholder="password"
          secure={!showPw}
          showToggle
          onToggle={() => setShowPw((v) => !v)}
          showPw={showPw}
        />
      </View>
      <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
        <Pressable hitSlop={6} onPress={handleReset}>
          <Text
            style={{
              fontFamily: font(aes, 'ui', 500),
              fontSize: 12.5,
              color: theme.textDim,
              textDecorationLine: 'underline',
              textDecorationColor: theme.rule,
            }}
          >
            Forgot password?
          </Text>
        </Pressable>
      </View>
      {message && (
        <Text
          style={{
            fontFamily: font(aes, 'ui', 500),
            fontSize: 13,
            color: messageIsInfo ? theme.accent : '#c0392b',
            marginTop: 10,
            textAlign: 'center',
          }}
        >
          {message}
        </Text>
      )}
      <SubmitButton
        theme={theme}
        aes={aes}
        label="Sign in"
        busy={busy}
        disabled={!valid}
        onPress={submit}
      />
    </View>
  );
}

interface SignUpFormProps {
  theme: Theme;
  aes: Aesthetic;
  email: string;
  onEmailChange: (v: string) => void;
  onSignUp: (email: string, pw: string) => Promise<SignUpResult>;
}

function SignUpForm({
  theme,
  aes,
  email,
  onEmailChange,
  onSignUp,
}: SignUpFormProps): React.ReactElement {
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsInfo, setMessageIsInfo] = useState(false);

  const showError = (msg: string) => {
    setMessage(msg);
    setMessageIsInfo(false);
  };
  const showInfo = (msg: string) => {
    setMessage(msg);
    setMessageIsInfo(true);
  };

  const strength = zxcvbn(pw);
  const valid = email.includes('@') && pw.length >= 6 && strength.score >= 3;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setMessage(null);
    const { error, needsConfirmation } = await onSignUp(email, pw);
    setBusy(false);
    if (needsConfirmation) showInfo('Check your email to confirm your account.');
    else if (error) showError(error);
  };

  return (
    <View style={s.form}>
      <FieldRow
        theme={theme}
        aes={aes}
        icon="mail"
        value={email}
        onChange={onEmailChange}
        placeholder="email"
        keyboardType="email-address"
      />
      <View style={{ marginTop: 12 }}>
        <FieldRow
          theme={theme}
          aes={aes}
          icon="lock"
          value={pw}
          onChange={setPw}
          placeholder="password"
          secure={!showPw}
          showToggle
          onToggle={() => setShowPw((v) => !v)}
          showPw={showPw}
        />
      </View>
      {pw.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor:
                    strength.score > i ? STRENGTH_COLORS[strength.score] : theme.rule,
                }}
              />
            ))}
          </View>
          <Text
            style={{
              fontFamily: font(aes, 'ui', 500),
              fontSize: 11.5,
              color: STRENGTH_COLORS[strength.score],
            }}
          >
            {STRENGTH_LABELS[strength.score]}
            {strength.feedback.warning ? ` — ${strength.feedback.warning}` : ''}
          </Text>
        </View>
      )}
      {message && (
        <Text
          style={{
            fontFamily: font(aes, 'ui', 500),
            fontSize: 13,
            color: messageIsInfo ? theme.accent : '#c0392b',
            marginTop: 10,
            textAlign: 'center',
          }}
        >
          {message}
        </Text>
      )}
      <SubmitButton
        theme={theme}
        aes={aes}
        label="Create account"
        busy={busy}
        disabled={!valid}
        onPress={submit}
      />
    </View>
  );
}

interface FieldRowProps {
  theme: Theme;
  aes: Aesthetic;
  icon: 'mail' | 'lock';
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  keyboardType?: 'email-address' | 'default';
  secure?: boolean;
  showToggle?: boolean;
  onToggle?: () => void;
  showPw?: boolean;
}

function FieldRow({
  theme,
  aes,
  icon,
  value,
  onChange,
  placeholder,
  keyboardType = 'default',
  secure,
  showToggle,
  onToggle,
  showPw,
}: FieldRowProps): React.ReactElement {
  return (
    <View style={[s.field, { backgroundColor: theme.surface, borderColor: theme.rule }]}>
      <View style={s.fieldIcon}>
        <PulseIcon name={icon} size={16} color={theme.textFaint} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textFaint}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoComplete={icon === 'mail' ? 'email' : 'password'}
        secureTextEntry={secure}
        style={[
          s.input,
          {
            color: theme.text,
            fontFamily: font(aes, 'ui', 500),
            paddingRight: showToggle ? 44 : 12,
          },
        ]}
      />
      {showToggle && (
        <Pressable onPress={onToggle} style={s.eyeBtn} hitSlop={8}>
          <PulseIcon name={showPw ? 'eye-off' : 'eye'} size={16} color={theme.textFaint} />
        </Pressable>
      )}
    </View>
  );
}

function SubmitButton({
  theme,
  aes,
  label,
  busy,
  disabled,
  onPress,
}: {
  theme: Theme;
  aes: Aesthetic;
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={[s.submit, { backgroundColor: disabled || busy ? theme.rule : theme.accent }]}
    >
      {busy ? (
        <ActivityIndicator color={theme.bg} size="small" />
      ) : (
        <Text style={{ fontFamily: font(aes, 'ui', 600), fontSize: 15, color: theme.bg }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 28, alignItems: 'center' },
  brand: { alignItems: 'center', marginBottom: 32 },
  wordmark: { flexDirection: 'row', alignItems: 'baseline', marginTop: 14 },
  toggle: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: 24,
    alignSelf: 'stretch',
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  form: { alignSelf: 'stretch' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    height: 48,
  },
  fieldIcon: { width: 44, alignItems: 'center' },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  eyeBtn: {
    position: 'absolute',
    right: 0,
    width: 44,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit: {
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
});
