"use client";

import { useState, useTransition, type FormEvent } from "react";

type Failure = { error: string };

/**
 * Submit a form to a `(prev, formData) => result` server action and run `onDone`
 * when it succeeds. Success is anything that is not `{ error }` — `null`, or a
 * result carrying something for the caller (e.g. `{ notice }`), which `onDone`
 * receives.
 *
 * Replaces `useActionState` + a "was pending, now isn't, no error" ref, which in
 * this codebase has been seen to silently miss the success edge (see
 * session-client's payment form): the action ran, but the modal never closed and
 * the screen behind it never refreshed. Here the result is awaited and acted on in
 * the same function, so a success cannot slip past.
 */
export function useFormSubmit<R extends object | null>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: (prev: any, formData: FormData) => Promise<R | Failure>,
  onDone: (result: R) => void
) {
  const [state, setState] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const res = await action(null, formData);
        if (res && typeof res === "object" && "error" in res && typeof res.error === "string") {
          setState(res as Failure);
          return;
        }
        setState(null);
        onDone(res as R);
      } catch {
        // A thrown action is almost always a stale action id after a deploy.
        setState({ error: "This page is out of date — refresh and try again." });
      }
    });
  };

  return { state, pending, onSubmit };
}
