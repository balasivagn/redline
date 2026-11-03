import type { CatalogEntry } from '../protocol';

const WHISPER_REPO = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const PARAKEET_REPO = 'https://huggingface.co/ggml-org/parakeet-GGUF/resolve/main';

/**
 * Sizes and sha256 values are the Hugging Face LFS object ids / sizes published for each file
 * (GET https://huggingface.co/api/models/<repo>/tree/main, field `lfs.oid` = sha256), read on
 * 2026-11-03. The base.en value was also confirmed against a copy already on this machine.
 */
export const CATALOG: CatalogEntry[] = [
  {
    catalogId: 'whisper-base.en',
    engine: 'whisper.cpp',
    label: 'whisper base.en',
    fileName: 'ggml-base.en.bin',
    url: `${WHISPER_REPO}/ggml-base.en.bin`,
    sizeBytes: 147964211,
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    note: 'fastest · okay',
  },
  {
    catalogId: 'whisper-small.en',
    engine: 'whisper.cpp',
    label: 'whisper small.en',
    fileName: 'ggml-small.en.bin',
    url: `${WHISPER_REPO}/ggml-small.en.bin`,
    sizeBytes: 487614201,
    sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
    note: 'fast · good',
  },
  {
    catalogId: 'whisper-large-v3-turbo',
    engine: 'whisper.cpp',
    label: 'whisper large-v3-turbo (q5_0)',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    url: `${WHISPER_REPO}/ggml-large-v3-turbo-q5_0.bin`,
    sizeBytes: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    note: 'slower · best',
  },
  {
    catalogId: 'parakeet-tdt-0.6b-v3',
    engine: 'parakeet',
    label: 'parakeet tdt 0.6b v3 (q8_0)',
    fileName: 'ggml-parakeet-tdt-0.6b-v3-q8_0.bin',
    url: `${PARAKEET_REPO}/ggml-parakeet-tdt-0.6b-v3-q8_0.bin`,
    sizeBytes: 668757119,
    sha256: '4d64e9e96c2792186d072fde0034df0ad670cf680a2f53069052ead827fd600e',
    note: 'fast · great English',
  },
];
