"use client";

import { useEffect } from "react";

declare global {
  interface ServiceWorkerContainer {
    register(
      scriptURL: string | TrustedScriptURL,
      options?: RegistrationOptions,
    ): Promise<ServiceWorkerRegistration>;
  }
}

type ServiceWorkerPolicy = {
  name: string;
  createScriptURL(url: string): TrustedScriptURL;
};

let serviceWorkerPolicy: ServiceWorkerPolicy | undefined;

function getServiceWorkerUrl(): string | TrustedScriptURL {
  if (!window.trustedTypes) return "/sw.js";

  serviceWorkerPolicy ??= window.trustedTypes.createPolicy(
    "xyro-service-worker",
    {
      createScriptURL: (url) => {
        if (url !== "/sw.js") {
          throw new TypeError("Unexpected service worker URL.");
        }
        return url;
      },
    },
  );

  return serviceWorkerPolicy.createScriptURL("/sw.js");
}

export default function PwaRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(getServiceWorkerUrl())
        .catch((error: unknown) => {
          console.error("Xyro AI service worker registration failed.", error);
        });
    }
  }, []);

  return null;
}
