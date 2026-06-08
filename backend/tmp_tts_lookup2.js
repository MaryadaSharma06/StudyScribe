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
  const url = `https://huggingface.co/api/models/${model}?expand[]=inferenceProviderMapping`;
  const res = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  console.log('MODEL', model, 'STATUS', res.status, 'CT', res.headers.get('content-type'));
  console.log(text.slice(0, 400));
}
