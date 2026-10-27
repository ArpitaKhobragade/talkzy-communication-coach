import { Card } from "./ui";

/** Plain-language explanation of how data is used. Shown in onboarding, settings and /privacy. */
export function PrivacyExplainer() {
  return (
    <Card className="space-y-4 text-[0.95rem] leading-relaxed">
      <h2 className="text-lg font-bold">How your information is used</h2>
      <dl className="space-y-3">
        <div>
          <dt className="font-semibold">Your voice (microphone)</dt>
          <dd className="text-muted">
            The coach listens only while you practise. Your voice is turned into text so the coach can answer you and your report can be written. We
            do not record or save your voice. You can type your answers instead.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Your camera (optional)</dt>
          <dd className="text-muted">
            If you turn it on, the camera is used only to see your face and body, so your report can tell you how you looked (for example nervous,
            tense or relaxed) and how to improve. The video stays on your device. It is never recorded, saved or sent anywhere.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What you say (text)</dt>
          <dd className="text-muted">
            The text of your answers is used to write your feedback. Please do not share personal details such as your full name, school, address or
            phone number.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What is saved, and where</dt>
          <dd className="text-muted">
            Your profile, settings and reports are saved only on this device, in this browser. There are no accounts or passwords. You can turn
            transcript saving off, delete any session, or delete everything at any time in Settings.
          </dd>
        </div>
      </dl>
    </Card>
  );
}
