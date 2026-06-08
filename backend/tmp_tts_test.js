import { HfInference } from '@huggingface/inference';

const hf = new HfInference('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');
const text = 'This is a short test of ResembleAI chatterbox text to speech.';

try {
  const audio = await hf.textToSpeech({
    provider: 'fal-ai',
    model: 'ResembleAI/chatterbox',
    inputs: text,
  });
  console.log('Got audio output type:', audio?.constructor?.name || typeof audio);
  if (typeof audio?.arrayBuffer === 'function') {
    const buffer = Buffer.from(await audio.arrayBuffer());
    console.log('Buffer length:', buffer.length);
  } else if (Buffer.isBuffer(audio)) {
    console.log('Buffer len', audio.length);
  } else {
    console.log('Audio output', audio);
  }
} catch (err) {
  console.error('ERROR', err);
}
