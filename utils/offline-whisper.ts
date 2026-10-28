import SherpaOnnx from "@siteed/sherpa-onnx.rn";
import {
  deleteAsync,
  documentDirectory,
  downloadAsync,
  getInfoAsync,
  makeDirectoryAsync,
} from "expo-file-system/legacy";

const MODEL_DIRECTORY = `${documentDirectory}models/whisper-tiny/`;
const MODEL_REVISION = "65176e2deb88badc814a94058666cadccc29b61c";
const MODEL_BASE_URL = `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/resolve/${MODEL_REVISION}`;

const MODEL_FILES = [
  { name: "tiny-encoder.int8.onnx", size: 12_937_772 },
  { name: "tiny-decoder.int8.onnx", size: 89_855_401 },
  { name: "tiny-tokens.txt", size: 816_730 },
] as const;

export const WHISPER_DOWNLOAD_BYTES = MODEL_FILES.reduce(
  (total, file) => total + file.size,
  0
);

function fileUrl(name: string): string {
  return `${MODEL_BASE_URL}/${encodeURIComponent(name)}?download=true`;
}

async function ensureDirectory(): Promise<void> {
  await makeDirectoryAsync(MODEL_DIRECTORY, { intermediates: true });
}

export async function isWhisperInstalled(): Promise<boolean> {
  for (const file of MODEL_FILES) {
    const info = await getInfoAsync(`${MODEL_DIRECTORY}${file.name}`, {
      size: true,
    });
    if (!info.exists || info.size !== file.size) {
      return false;
    }
  }
  return true;
}

export async function installWhisper(
  onProgress?: (fraction: number) => void
): Promise<void> {
  await ensureDirectory();
  const totalBytes = WHISPER_DOWNLOAD_BYTES;
  let completeBytes = 0;

  for (const file of MODEL_FILES) {
    const destination = `${MODEL_DIRECTORY}${file.name}`;
    const current = await getInfoAsync(destination, { size: true });
    if (current.exists && current.size === file.size) {
      completeBytes += file.size;
      onProgress?.(completeBytes / totalBytes);
      continue;
    }

    await deleteAsync(destination, { idempotent: true });
    const result = await downloadAsync(fileUrl(file.name), destination);
    if (result.status !== 200) {
      await deleteAsync(destination, { idempotent: true });
      throw new Error(`Could not download ${file.name} (${result.status}).`);
    }

    const installed = await getInfoAsync(destination, { size: true });
    if (!installed.exists || installed.size !== file.size) {
      await deleteAsync(destination, { idempotent: true });
      throw new Error(`Downloaded ${file.name} did not pass the size check.`);
    }

    completeBytes += file.size;
    onProgress?.(completeBytes / totalBytes);
  }
}

export async function transcribeVoiceNote(uri: string): Promise<string> {
  if (!(await isWhisperInstalled())) {
    throw new Error("Download the offline voice model before transcribing.");
  }

  await SherpaOnnx.ASR.initialize({
    decodingMethod: "greedy_search",
    language: "",
    modelDir: MODEL_DIRECTORY,
    modelFiles: {
      decoder: "tiny-decoder.int8.onnx",
      encoder: "tiny-encoder.int8.onnx",
      tokens: "tiny-tokens.txt",
    },
    modelType: "whisper",
    numThreads: 2,
    streaming: false,
  });

  try {
    const result = await SherpaOnnx.ASR.recognizeFromFile(uri);
    const text = result.text.trim();
    if (!text) {
      throw new Error("No speech was recognised. Try recording closer to the phone.");
    }
    return text;
  } finally {
    await SherpaOnnx.ASR.release();
  }
}
