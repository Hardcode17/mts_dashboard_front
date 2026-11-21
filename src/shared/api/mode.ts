/// <reference types="vite/client" />

export const usesRealBackend = import.meta.env?.VITE_BACKEND_MODE === 'real' || Boolean(import.meta.env?.VITE_API_URL)
