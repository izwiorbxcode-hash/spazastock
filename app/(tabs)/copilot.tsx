import { Ionicons } from "@expo/vector-icons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Dialog, Input, Label, TextField } from "heroui-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import db, { getLowStockThreshold } from "@/database/db";
import type { CopilotEvent } from "@/types";
import { commitCopilotPlan, previewCopilotNote, type CopilotPlan } from "@/utils/copilot";
import { formatRand } from "@/utils/format";
import {
  installWhisper,
  isWhisperInstalled,
  transcribeVoiceNote,
  WHISPER_DOWNLOAD_BYTES,
} from "@/utils/offline-whisper";

type Snapshot = { stock: number; credit: number; lowItems: number };
type WhisperStatus = "checking" | "downloading" | "missing" | "ready";

const WHISPER_DOWNLOAD_MEGABYTES = Math.round(WHISPER_DOWNLOAD_BYTES / 1_000_000);

export default function CopilotScreen() {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [events, setEvents] = useState<CopilotEvent[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>({ stock: 0, credit: 0, lowItems: 0 });
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<CopilotPlan | null>(null);
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus>("checking");
  const [whisperProgress, setWhisperProgress] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorder = useAudioRecorder({ ...RecordingPresets.LOW_QUALITY, directory: "document" });
  const recorderState = useAudioRecorderState(recorder);

  const load = useCallback(() => {
    const threshold = getLowStockThreshold();
    const stock = db.getFirstSync<{ count: number }>("SELECT COUNT(*) AS count FROM products")?.count ?? 0;
    const lowItems = db.getFirstSync<{ count: number }>("SELECT COUNT(*) AS count FROM products WHERE stockQty <= ?", [threshold])?.count ?? 0;
    const owed = db.getFirstSync<{ amount: number | null }>("SELECT SUM(totalAmount) AS amount FROM sales WHERE paymentMethod = 'TICK'")?.amount ?? 0;
    const paid = db.getFirstSync<{ amount: number | null }>("SELECT SUM(amount) AS amount FROM payments")?.amount ?? 0;
    setSnapshot({ stock, lowItems, credit: Math.max(0, owed - paid) });
    setEvents(db.getAllSync<CopilotEvent>("SELECT * FROM copilot_events ORDER BY createdAt DESC LIMIT 4"));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    let isCurrent = true;

    void isWhisperInstalled().then((installed) => {
      if (isCurrent) {
        setWhisperStatus(installed ? "ready" : "missing");
      }
    }).catch(() => {
      if (isCurrent) {
        setWhisperStatus("missing");
      }
    });

    return () => {
      isCurrent = false;
    };
  }, []);

  const submit = useCallback(() => {
    try {
      setPendingPlan(previewCopilotNote(note));
    } catch (error) {
      Alert.alert("Could not understand that", error instanceof Error ? error.message : "Try a shorter note.");
    }
  }, [note]);

  const confirmPlan = useCallback(() => {
    if (!pendingPlan) return;
    commitCopilotPlan(note, pendingPlan);
    setPendingPlan(null);
    setNote("");
    load();
    Alert.alert("Spaza OS updated", pendingPlan.summary);
  }, [load, note, pendingPlan]);

  const downloadWhisper = useCallback(async () => {
    try {
      setWhisperStatus("downloading");
      setWhisperProgress(0);
      await installWhisper(setWhisperProgress);
      setWhisperStatus("ready");
      setVoiceMessage("Offline voice AI is ready. New shop voice notes will be transcribed on this phone.");
    } catch (error) {
      setWhisperStatus("missing");
      Alert.alert(
        "Could not download voice AI",
        error instanceof Error ? error.message : "Check your connection and try again.",
      );
    }
  }, []);

  const transcribeSavedVoiceNote = useCallback(async (uri: string) => {
    setIsTranscribing(true);
    setVoiceMessage("Transcribing on this phone…");
    try {
      const transcript = await transcribeVoiceNote(uri);
      setNote(transcript);
      setVoiceMessage("Voice note transcribed privately. Review the text, then save the shop update.");
    } catch (error) {
      setVoiceMessage(
        error instanceof Error
          ? `Voice note saved, but transcription needs another try: ${error.message}`
          : "Voice note saved, but transcription needs another try.",
      );
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const transcribeLatestVoiceNote = useCallback(async () => {
    const latestVoiceNote = db.getFirstSync<{ uri: string }>(
      "SELECT uri FROM voice_notes ORDER BY createdAt DESC LIMIT 1",
    );
    if (!latestVoiceNote) {
      setVoiceMessage("Record a shop voice note first, then it can be transcribed offline.");
      return;
    }
    await transcribeSavedVoiceNote(latestVoiceNote.uri);
  }, [transcribeSavedVoiceNote]);

  const toggleRecording = useCallback(async () => {
    try {
      if (recorderState.isRecording) {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) throw new Error("The voice note was not saved. Please try again.");
        db.runSync(
          "INSERT INTO voice_notes (id, uri, durationMs, createdAt) VALUES (?, ?, ?, ?)",
          [`voice-${Date.now()}`, uri, Math.round(recorderState.durationMillis), Date.now()],
        );
        if (whisperStatus === "ready") {
          await transcribeSavedVoiceNote(uri);
        } else {
          setVoiceMessage("Voice note saved privately on this phone. Download Offline Voice AI to transcribe it without data.");
        }
        return;
      }

      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microphone permission needed", "Allow microphone access to capture a private shop voice note.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setVoiceMessage(null);
    } catch (error) {
      Alert.alert("Could not record", error instanceof Error ? error.message : "Please try again.");
    }
  }, [recorder, recorderState.durationMillis, recorderState.isRecording, transcribeSavedVoiceNote, whisperStatus]);

  const examples = useMemo(() => [
    "Mama Thandi owes R85 for bread and airtime",
    "Engeza 12 Coke",
    "Thandi paid R50",
    "Thandi skuld R85 vir bread",
  ], []);

  return (
    <Container className="px-4 pt-3">
      <View className="rounded-2xl bg-accent p-5">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xs font-semibold uppercase tracking-widest text-accent-foreground">Spaza OS</Text>
            <Text className="mt-1 text-2xl font-bold text-accent-foreground">Your shop, in your pocket.</Text>
          </View>
          <Ionicons name="sparkles" size={28} color="white" />
        </View>
        <Text className="mt-2 text-sm text-accent-foreground">Works offline. Your notes and records stay on this phone.</Text>
      </View>

      <View className="mt-4 rounded-2xl bg-surface p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3"><Text className="font-semibold text-foreground">What happened in the shop?</Text><Text className="mt-1 text-xs text-muted">Record it privately, then use a short summary to update stock or credit.</Text></View>
          <Pressable onPress={() => void toggleRecording()} accessibilityLabel={recorderState.isRecording ? "Stop voice note" : "Record voice note"} className={`h-12 w-12 items-center justify-center rounded-full ${recorderState.isRecording ? "bg-danger" : "bg-accent"}`}>
            <Ionicons name={recorderState.isRecording ? "stop" : "mic"} size={22} color="white" />
          </Pressable>
        </View>
        {recorderState.isRecording ? <Text className="mt-3 rounded-xl bg-background p-3 text-sm font-medium text-foreground">Recording {Math.floor(recorderState.durationMillis / 1000)}s — tap stop when you finish.</Text> : null}
        {voiceMessage ? <Text className="mt-3 rounded-xl bg-background p-3 text-xs text-muted">{voiceMessage}</Text> : null}
        {whisperStatus === "ready" ? <View className="mt-3 gap-2"><Text className="text-xs font-medium text-success">Offline Voice AI is ready — transcription stays on this phone.</Text><Pressable onPress={() => void transcribeLatestVoiceNote()} disabled={isTranscribing} className="self-start rounded-full bg-background px-3 py-2"><Text className="text-xs font-semibold text-accent">Transcribe latest saved voice note</Text></Pressable></View> : null}
        {whisperStatus === "missing" || whisperStatus === "downloading" ? <Button className="mt-3" variant="secondary" onPress={() => void downloadWhisper()} isDisabled={whisperStatus === "downloading"}>
          <Ionicons name="download-outline" size={18} color="white" />
          <Button.Label>{whisperStatus === "downloading" ? `Downloading ${Math.round(whisperProgress * 100)}%` : `Download Offline Voice AI (${WHISPER_DOWNLOAD_MEGABYTES} MB)`}</Button.Label>
        </Button> : null}
        {isTranscribing ? <Text className="mt-3 text-xs font-medium text-accent">Working offline — this can take a moment.</Text> : null}
        <TextField className="mt-4">
          <Label>Quick shop note</Label>
          <Input value={note} onChangeText={setNote} placeholder="e.g. Mama Thandi owes R85 for bread" returnKeyType="done" onSubmitEditing={submit} />
        </TextField>
        <Button className="mt-3" onPress={submit} isDisabled={!note.trim()}>
          <Ionicons name="arrow-up" size={18} color="white" />
          <Button.Label>Save offline</Button.Label>
        </Button>
        <View className="mt-3 flex-row flex-wrap gap-2">
          {examples.map((example) => <Pressable key={example} onPress={() => setNote(example)} className="rounded-full bg-background px-3 py-2"><Text className="text-xs text-muted">{example}</Text></Pressable>)}
        </View>
      </View>

      <View className="mt-5 flex-row gap-2">
        <Pressable onPress={() => router.push("/(tabs)/inventory")} className="flex-1 rounded-2xl bg-surface p-4">
          <Text className="text-xs text-muted">Low stock</Text><Text className="mt-1 text-2xl font-bold text-foreground">{snapshot.lowItems}</Text><Text className="mt-1 text-xs text-muted">of {snapshot.stock} products</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/(tabs)/credit")} className="flex-1 rounded-2xl bg-surface p-4">
          <Text className="text-xs text-muted">On the book</Text><Text className="mt-1 text-2xl font-bold text-foreground">{formatRand(snapshot.credit)}</Text><Text className="mt-1 text-xs text-muted">tap to settle tabs</Text>
        </Pressable>
      </View>

      <View className="mt-6"><Text className="mb-2 font-semibold text-foreground">Recent updates</Text>
        {events.length === 0 ? <Text className="rounded-xl bg-surface p-4 text-sm text-muted">Start with a quick note. Spaza OS will turn it into a local shop record.</Text> : events.map((event) => <View key={event.id} className="mb-2 rounded-xl bg-surface p-4"><Text className="text-xs font-semibold text-muted">{event.actionType}</Text><Text className="mt-1 font-medium text-foreground">{event.summary}</Text><Text className="mt-1 text-xs text-muted">“{event.rawText}”</Text></View>)}
      </View>

      <Dialog isOpen={pendingPlan !== null} onOpenChange={(open) => { if (!open) setPendingPlan(null); }}>
        <Dialog.Portal><Dialog.Overlay /><Dialog.Content>
          <Dialog.Title>Check this update</Dialog.Title>
          <Dialog.Description>Spaza OS understood:</Dialog.Description>
          <View className="mt-4 rounded-xl bg-surface p-4"><Text className="text-xs font-semibold text-muted">{pendingPlan?.actionType}</Text><Text className="mt-1 text-base font-semibold text-foreground">{pendingPlan?.summary}</Text></View>
          <Text className="mt-3 text-xs text-muted">Nothing changes until you confirm.</Text>
          <Button className="mt-5" onPress={confirmPlan}><Button.Label>Confirm & save offline</Button.Label></Button>
          <Button className="mt-2" variant="secondary" onPress={() => setPendingPlan(null)}><Button.Label>Edit note</Button.Label></Button>
        </Dialog.Content></Dialog.Portal>
      </Dialog>
    </Container>
  );
}
