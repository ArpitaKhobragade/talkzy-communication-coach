import type { CoachingItem, VisionMetrics } from "../session/types";

/*
 * What the camera saw, and what to change. The first point says how the student came across (for
 * example nervous, tense or relaxed). That comes from the shape of the face and the body, so it says
 * how the student LOOKED to a listener, not what they felt. The words are plain and have no numbers.
 */

const item = (kind: CoachingItem["kind"], topic: string, observation: string, why?: string, howTo?: string): CoachingItem => ({
  kind,
  topic,
  observation,
  why,
  howTo,
});

const howOften = (pct: number) => (pct >= 40 ? "a lot of the time" : pct >= 20 ? "some of the time" : "now and then");

/** Signs that usually make a speaker look nervous. */
export function nervousSigns(v: VisionMetrics): string[] {
  const signs: string[] = [];
  if ((v.worriedPct ?? 0) >= 25) signs.push("your eyebrows were raised in a worried way");
  if ((v.blinkPct ?? 0) >= 12) signs.push("you blinked a lot");
  if (v.movementLevel === "high") signs.push("you moved around a lot");
  if (v.cameraFacingPct !== null && v.cameraFacingPct < 60) signs.push("you often looked away from the camera");
  if ((v.lookingDownPct ?? 0) >= 35) signs.push("you often looked down");
  return signs;
}

export function buildBodyLanguageCoaching(v: VisionMetrics | null): CoachingItem[] {
  if (!v || v.framesAnalyzed < 10) return [];
  const out: CoachingItem[] = [];

  // 1. How you came across. Only when the face model gave expression scores.
  const hasLooks = v.tensePct != null && v.worriedPct != null && v.smilePct != null;
  const signs = nervousSigns(v);
  const nervous = hasLooks && (signs.length >= 2 || (v.worriedPct ?? 0) >= 45);
  const tense = hasLooks && (v.tensePct ?? 0) >= 30;
  const smile = v.smilePct ?? 0;

  if (nervous) {
    out.push(
      item(
        "improve",
        "You looked nervous",
        `You looked a little nervous: ${signs.join(", ")}.`,
        "When a speaker looks nervous, listeners may think the speaker is not sure about the answer.",
        "Before each answer, breathe in slowly and let your shoulders drop. Speak a little slower, rest your hands on the desk, and look at the camera when you start.",
      ),
    );
  }
  if (tense) {
    out.push(
      item(
        "improve",
        "Your face looked tense",
        `Your eyebrows were pulled down or your lips were pressed together ${howOften(v.tensePct ?? 0)}, so you can look serious or angry.`,
        "A tight face can make a friendly answer sound cross.",
        "Relax your forehead and your jaw, and let your eyebrows rest. Smile a little when you start and when you finish.",
      ),
    );
  }
  if (hasLooks && (v.oddFacePct ?? 0) >= 4) {
    out.push(
      item(
        "improve",
        "Unusual faces",
        "You made some unusual faces, like a wink, puffed cheeks or a tongue out.",
        "Funny faces take attention away from what you say.",
        "Keep your face natural while you answer. Save playful faces for after the session.",
      ),
    );
  }
  if (hasLooks && !nervous && !tense) {
    if (smile >= 15) {
      out.push(item("good", "How you looked", `You looked relaxed and friendly. You smiled ${howOften(smile)}, and this helps listeners feel at ease.`));
    } else if (v.facialMovementLevel === "low") {
      out.push(
        item(
          "improve",
          "Your face showed little expression",
          "Your face stayed very still while you spoke, so you can look flat or bored.",
          "A face that moves a little, like a smile or raised eyebrows, helps people follow your ideas and feel welcome.",
          "Smile when you say hello and goodbye. Let your eyebrows go up when you say something important. Practise one answer in front of a mirror.",
        ),
      );
    } else {
      out.push(item("good", "How you looked", "You looked calm and steady, and your face moved in a natural way."));
    }
  } else if (!hasLooks) {
    if (v.facialMovementLevel === "low") {
      out.push(
        item(
          "improve",
          "Your face showed little expression",
          "Your face stayed very still while you spoke.",
          "A face that moves a little, like a smile or raised eyebrows, helps people follow your ideas and feel welcome.",
          "Smile when you say hello and goodbye. Let your eyebrows go up when you say something important.",
        ),
      );
    } else if (v.facialMovementLevel === "moderate") {
      out.push(item("good", "Your face while talking", "Your face moved in a natural way while you spoke."));
    }
  }
  if (smile >= 20 && (nervous || tense)) {
    out.push(item("good", "Your smile", `You smiled ${howOften(smile)}. Keep that, and add it to the calm face above.`));
  }

  // 2. Where your face and head were.
  if (v.facePresentPct < 70) {
    out.push(
      item(
        "improve",
        "Your face in the picture",
        "Your face was often out of the picture.",
        "When your face leaves the picture, the listener loses eye contact with you.",
        "Sit so your whole face stays in the picture. Put a light in front of you (not behind you) and the camera at eye level.",
      ),
    );
  } else {
    out.push(item("good", "Your face in the picture", "Your face stayed in the picture."));
  }

  if (v.cameraFacingPct !== null) {
    if (v.cameraFacingPct >= 75) {
      out.push(item("good", "Looking at the camera", "You faced the camera most of the time. This helps the listener feel you are talking to them."));
    } else {
      out.push(
        item(
          "improve",
          "Looking at the camera",
          "Your head was often turned away from the camera.",
          "When you face the person you talk to, they feel you are speaking to them.",
          "Put your notes or the question close to the camera, so looking at them still faces the camera. Look at the camera lens when you start and finish each point.",
        ),
      );
    }
  }
  if ((v.lookingDownPct ?? 0) >= 35 && !(v.avgHeadPitchDeg !== null && v.avgHeadPitchDeg >= 15)) {
    out.push(
      item(
        "improve",
        "Looking down",
        "Your eyes were often looking down instead of at the camera.",
        "Looking down can make you look unsure, or as if you are reading.",
        "Put your notes or screen at eye level. Look up at the camera at the start and at the end of each point.",
      ),
    );
  }
  if (v.avgHeadPitchDeg !== null && v.avgHeadPitchDeg >= 15) {
    out.push(item("improve", "Head up and down", "Your head was often tilted up or down.", "Looking down at a low screen hides your face and can hurt your neck.", "Raise your laptop or camera to eye level so you can look straight ahead."));
  }
  if (v.avgHeadYawDeg !== null && v.avgHeadYawDeg >= 20) {
    out.push(item("improve", "Head turned to the side", "Your head was often turned to the side.", undefined, "Sit straight in front of the screen and the camera, not at an angle."));
  }

  // 3. How you sat and moved.
  if (v.uprightPct !== null) {
    if (v.uprightPct >= 75) {
      out.push(item("good", "How you sat", "You sat upright and balanced."));
    } else {
      out.push(
        item(
          "improve",
          "How you sat",
          "You were not sitting upright and balanced for much of the session.",
          "Sitting tall helps your voice come out clearly, and you look steady on camera.",
          "Sit tall with both feet flat on the floor. Relax your shoulders and keep them level. Sit in the middle of the picture and do not lean to one side.",
        ),
      );
    }
  } else if (v.bodyVisiblePct < 30) {
    out.push(item("info", "How you sat", "Your shoulders were rarely in view, so we could not check how you sat.", undefined, "Move your chair back a little so your head and both shoulders fit in the picture."));
  }

  if (v.movementLevel === "high") {
    out.push(item("improve", "Your body and hands", "You moved a lot during the session.", "A lot of movement can pull attention away from what you say.", "Rest your hands on the desk between gestures. Keep your body still while you make a point."));
  } else if (v.movementLevel === "low" && v.handsVisiblePct !== null && v.handsVisiblePct < 15) {
    out.push(item("info", "Your body and hands", "Your hands were hardly seen, and you stayed very still.", "Small hand movements can help people follow your ideas.", "Try one or two small hand movements when you explain an example. Keep your hands inside the picture."));
  } else if (v.movementLevel === "moderate") {
    out.push(item("good", "Your body and hands", "Your body movement looked natural."));
  }
  return out;
}
