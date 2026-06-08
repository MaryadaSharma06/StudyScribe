const models = [
  'microsoft/VibeVoice-1.5B',
  'microsoft/VibeVoice-Realtime-0.5B',
  'ResembleAI/chatterbox',
  'openbmb/VoxCPM2',
  'coqui/XTTS-v2',
  'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
  'sbintuitions/sarashina2.2-tts',
  'k2-fsa/OmniVoice',
];

const token = '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';

for (const model of models) {
  const url = 'https://huggingface.co/api/models/' + encodeURIComponent(model) + '?expand[]=inferenceProviderMapping';
  const res = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
    },
  });
  const data = await res.json();
  const mappingCount = data.inferenceProviderMapping && typeof data.inferenceProviderMapping === 'object' ? Object.keys(data.inferenceProviderMapping).length : 0;
  console.log('MODEL', model, 'STATUS', res.status, 'MAPPING', mappingCount, 'KEYS', mappingCount ? Object.keys(data.inferenceProviderMapping) : 'NONE');
}
