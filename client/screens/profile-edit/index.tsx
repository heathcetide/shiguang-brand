import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard, ActivityIndicator, Image } from 'react-native';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import * as ImagePicker from 'expo-image-picker';
import { DEFAULT_AVATARS, getAvatarSource, getPresetAvatarValue } from '@/utils/defaultAvatar';
import { useAppThemeColors } from '@/hooks/useAppThemeColors';
import { authApi } from '@/services/api/auth';

type PublicProfile = NonNullable<ReturnType<typeof useAuth>['user']>;

export default function ProfileEditScreen() {
  const { user, token } = useAuth();
  return user && token ? <ProfileEditLoader key={`${user.id}:${token}`} token={token} /> : null;
}

function ProfileEditLoader({ token }: { token: string }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    void authApi.me<PublicProfile>(token).then(value => {
      if (active) { setProfile(value); setError(''); }
    }).catch(() => { if (active) setError('公开资料读取失败，请重试后再编辑'); });
    return () => { active = false; };
  }, [token, attempt]);
  if (!profile) return <Screen><View className="flex-1 items-center justify-center gap-4 p-6">{error ? <><Text accessibilityRole="alert" className="text-critical">{error}</Text><TouchableOpacity onPress={() => { setError(''); retry(value => value + 1); }}><Text className="text-brand">重试</Text></TouchableOpacity></> : <ActivityIndicator />}</View></Screen>;
  return <ProfileEditForm initialProfile={profile} />;
}

function ProfileEditForm({ initialProfile }: { initialProfile: PublicProfile }) {
  const { user, updateProfile } = useAuth();
  const router = useSafeRouter();
  const colors = useAppThemeColors();
  const styles = createStyles(colors);
  const [username, setUsername] = useState(initialProfile.username);
  const [bio, setBio] = useState(initialProfile.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(
    initialProfile.avatar_url || getPresetAvatarValue(initialProfile.id % DEFAULT_AVATARS.length),
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });

    if (mounted.current && !result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      if (asset.base64) {
        setAvatarUrl(`data:image/jpeg;base64,${asset.base64}`);
      } else {
        setAvatarUrl(asset.uri);
      }
    }
  };

  const handleSave = async () => {
    if (sending.current) return;
    if (username.trim().length < 2) { setMessage('昵称请填写 2–30 个字符'); return; }
    sending.current = true;
    setLoading(true);
    setMessage('');
    const result = await updateProfile({ 
      username: username.trim(),
      bio: bio.trim(),
      avatar_url: avatarUrl,
    });
    sending.current = false;
    if (!mounted.current) return;
    setLoading(false);
    if (result.success) {
      setMessage('已保存公开资料');
    } else {
      setMessage(result.error || '保存失败，请重试');
    }
  };

  return (
    <Screen>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <FontAwesome6 name="arrow-left" size={20} colorClassName="accent-brand-strong" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>编辑资料</Text>
            <TouchableOpacity onPress={handleSave} disabled={loading}>
              {loading ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <Text style={styles.saveText}>保存</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} contentContainerStyle={{ padding: 24 }}>
            {/* Avatar */}
            <View style={styles.avatarSection}>
              <TouchableOpacity style={styles.avatar} onPress={pickImage} activeOpacity={0.8}>
                <Image
                  source={getAvatarSource(avatarUrl, user?.id ?? user?.username)}
                  style={styles.avatarImage}
                />
                <View style={styles.editIconBadge}>
                  <FontAwesome6 name="camera" size={12} colorClassName="accent-on-brand" />
                </View>
              </TouchableOpacity>
              <Text style={styles.username}>{user?.username || `食友${user?.id || ''}`}</Text>
              <Text style={styles.avatarHint}>选择食光头像，或点击上方上传照片</Text>
              <View style={styles.presetAvatarRow}>
                {DEFAULT_AVATARS.map((source, index) => {
                  const value = getPresetAvatarValue(index);
                  const selected = avatarUrl === value;
                  return (
                    <TouchableOpacity
                      key={value}
                      onPress={() => setAvatarUrl(value)}
                      activeOpacity={0.8}
                      style={[styles.presetAvatarButton, selected && styles.presetAvatarButtonSelected]}
                    >
                      <Image source={source} style={styles.presetAvatarImage} />
                      {selected ? (
                        <View style={styles.presetAvatarCheck}>
                          <FontAwesome6 name="check" size={8} colorClassName="accent-on-brand" />
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Form */}
            <View style={styles.form}>
              {message ? <Text accessibilityLiveRegion="polite" className="text-brand">{message}</Text> : null}
              <View style={styles.field}>
                <Text style={styles.label}>用户名</Text>
                <View style={styles.inputGroup}>
                  <TextInput
                    style={styles.input}
                    value={username}
                    onChangeText={value => { setUsername(value); setMessage(''); }}
                    placeholder="社区和菜谱中公开显示的名称"
                    placeholderTextColor={colors['copy-muted']}
                    maxLength={30}
                  />
                </View>
                <Text className="mt-1 text-xs text-copy-muted">2–30 个字符，公开显示，可随时修改</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>个人简介</Text>
                <View style={[styles.inputGroup, styles.textAreaGroup]}>
                  <TextInput
                    style={styles.textArea}
                    value={bio}
                    onChangeText={setBio}
                    placeholder="介绍一下自己..."
                    placeholderTextColor={colors['copy-muted']}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </View>
              </View>

              <TouchableOpacity onPress={() => router.push('/health-profile', { section: 'nutrition' })}>
                <Text style={styles.saveText}>管理营养目标与饮食偏好 ›</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </Screen>
  );
}

const createStyles = (colors: ReturnType<typeof useAppThemeColors>) => StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: colors['brand-strong'] },
  saveText: { fontSize: 16, fontWeight: '600', color: colors.brand },
  content: { flex: 1 },
  avatarSection: { alignItems: 'center', marginBottom: 28, marginTop: 16 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors['brand-soft'], alignItems: 'center', justifyContent: 'center',
    marginBottom: 12, position: 'relative',
  },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  editIconBadge: {
    position: 'absolute', right: 0, bottom: 0,
    backgroundColor: colors['brand-fill'], width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.surface,
  },
  username: { fontSize: 14, color: colors.brand },
  avatarHint: { fontSize: 12, color: colors['copy-muted'], marginTop: 14, marginBottom: 10 },
  presetAvatarRow: { flexDirection: 'row', gap: 8 },
  presetAvatarButton: {
    width: 42, height: 42, borderRadius: 21, padding: 2,
    borderWidth: 2, borderColor: 'transparent', position: 'relative',
  },
  presetAvatarButtonSelected: { borderColor: colors.brand },
  presetAvatarImage: { width: 34, height: 34, borderRadius: 17 },
  presetAvatarCheck: {
    position: 'absolute', right: -2, bottom: -2, width: 16, height: 16,
    borderRadius: 8, backgroundColor: colors['brand-fill'], borderWidth: 2, borderColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  form: { gap: 24 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: colors['brand-strong'], paddingLeft: 4 },
  inputGroup: {
    backgroundColor: colors['background-secondary'], borderRadius: 16, padding: 16,
  },
  textAreaGroup: { minHeight: 100 },
  input: { fontSize: 16, color: colors.ink, paddingVertical: 0 },
  textArea: { fontSize: 16, color: colors.ink, minHeight: 80 },
});
