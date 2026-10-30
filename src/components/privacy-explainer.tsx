import { Card } from "./ui";

/** The short permission shown at sign-up: what is switched on while practising, and who sees the reports. */
export function ConsentNotice() {
  return (
    <div data-testid="consent-notice">
      <Card className="space-y-2 text-[0.95rem] leading-relaxed">
        <p className="font-semibold">
          The camera and the microphone are in use while you practise.
        </p>
        <p className="text-muted">
          Your name and your reports are shared with your college&apos;s Talkzy
          admin. Nothing is recorded as audio or video.
        </p>
      </Card>
    </div>
  );
}

/** Plain-language explanation of how data is used. Shown in settings and /privacy. */
export function PrivacyExplainer() {
  return (
    <Card className="space-y-4 text-[0.95rem] leading-relaxed">
      <h2 className="text-lg font-bold">How your information is used</h2>
      <dl className="space-y-3">
        <div>
          <dt className="font-semibold">Your voice (microphone)</dt>
          <dd className="text-muted">
            The coach listens only while you practise. Your voice is turned into
            text so the coach can answer you and your report can be written. We
            do not record or save your voice.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Your camera</dt>
          <dd className="text-muted">
            The camera is on while you practise. It is used only to see your
            face and body, so your report can tell you how you looked (for
            example nervous, tense or relaxed) and how to improve. If your
            browser blocks it, you can still practise without it. The video
            stays on your device. It is never recorded, saved or sent anywhere.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What you say (text)</dt>
          <dd className="text-muted">
            The text of your answers is used to write your feedback. Please do
            not share personal details such as your address or phone number.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What is saved, and where</dt>
          <dd className="text-muted">
            Your profile, settings and reports are saved on this device, in this
            browser. Your name and each report (the written feedback and scores,
            not your voice or video) are also sent to your college&apos;s Talkzy
            admin, who can see and download them. There are no student
            passwords. You can delete the copy on this device at any time in
            Settings.
          </dd>
        </div>
      </dl>
    </Card>
  );
}
