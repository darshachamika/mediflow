import type { User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";
import { OpdRequestError, opdRequest } from "./opd-request";

export function clinicalError(error: unknown, fallback: string) {
  if (!(error instanceof OpdRequestError)) return fallback;
  switch (error.status) {
    case 400: return "Check the form values and try again.";
    case 401: return "Your session was rejected. Sign out and sign in again.";
    case 403: return "You do not have permission to access this clinical information.";
    case 404: return "This record is unavailable or outside your care assignment.";
    case 409: return "The record or slot changed. Refresh and try again.";
    default: return fallback;
  }
}

export function useClinicalResource<T>(user: User, apiUrl: string, path: string, roomRevision = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => {
    setLoading(true);
    setError("");
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const result = await opdRequest<T>(user, apiUrl, path, { signal });
        if (!signal.aborted) {
          setData(result);
          setError("");
        }
      } catch (error) {
        if (!signal.aborted) {
          setData(null);
          setError(clinicalError(error, "Could not load this information. Try refreshing."));
        }
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [user, apiUrl, path, revision, roomRevision]);

  return { data, error, loading, refresh };
}
