import { Card } from "./ui";

/** Plain-language explanation of how data is processed. Shown in onboarding, settings and /privacy. */
export function PrivacyExplainer() {
  return (
    <Card className="space-y-4 text-[0.95rem] leading-relaxed">
      <h2 className="text-lg font-bold">How your information is used</h2>
      <dl className="space-y-3">
        <div>
          <dt className="font-semibold">Your voice (microphone)</dt>
          <dd className="text-muted">
            The coach listens only during practice. Your device finds when you are speaking, and short clips of your speech are sent securely to a
            speech-to-text service (Sarvam AI) through this app&apos;s server, which turns them into text. If that service is not set up, your browser
            does it instead and, in Chrome and Edge, may send audio to the browser company&apos;s speech service (for example Google or Microsoft). We do
            not record or save your audio, and the server forwards each clip and forgets it. You can always type your answers instead.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">The coach&apos;s voice</dt>
          <dd className="text-muted">
            The coach&apos;s words are sent to a text-to-speech service (Cartesia) to create the spoken audio, or spoken by your browser if that is not set
            up. Only the coach&apos;s own sentences are sent, not your answers.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Your camera (optional)</dt>
          <dd className="text-muted">
            If you turn it on, video is analysed inside your browser on your device. It is never recorded, saved or uploaded, and this app
            blocks the analysis software from contacting any outside server. Only simple numbers are kept (for example, how often your face
            was visible). The camera cannot tell how you feel, and we do not claim it can.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What you say (text)</dt>
          <dd className="text-muted">
            The text of your answers is sent securely to our server and to an AI service (Groq or Anthropic, depending on how the app is set up) so
            the coach can reply and write your feedback. Please do not share personal details such as your full name, school, address or phone
            number.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What is saved, and where</dt>
          <dd className="text-muted">
            Your profile, settings, session reports and (if you allow it) transcripts are saved only on this device, in this browser. There are
            no accounts or passwords. You can turn transcript saving off, delete any session, export your data, or delete everything at any
            time in Settings.
          </dd>
        </div>
      </dl>
    </Card>
  );
}
