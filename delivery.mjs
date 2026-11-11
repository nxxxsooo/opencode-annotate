// Explicitly sent feedback starts an idle session or reaches a running turn's next
// processing boundary. Queueing based on cached status can leave it waiting for a
// later turn. Tests may suppress execution while exercising the real API.
export function feedbackInput(input) {
  return { ...input, delivery: "steer", resume: input.resume ?? true }
}
