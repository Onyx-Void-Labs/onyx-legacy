
export class PasskeyService {

    // --- UTILS: Base64URL Encoding/Decoding ---

    // Encode ArrayBuffer to Base64URL string (RFC 4648)
    static bufferToBase64URL(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        let str = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            str += String.fromCharCode(bytes[i]);
        }
        return btoa(str)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    // Decode Base64URL string to Uint8Array
    static base64URLToBuffer(base64url: string): Uint8Array {
        const padding = '='.repeat((4 - base64url.length % 4) % 4);
        const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            output[i] = raw.charCodeAt(i);
        }
        return output;
    }

    // --- REGISTRATION ---

    /**
     * Registers a new Passkey (WebAuthn Credential) for the user.
     * @param username Display name for the credential (e.g. "Omar")
     * @param userId Stable user ID (e.g. "u_8x3k2n")
     */
    static async register(username: string, userId: string): Promise<any> {
        console.group("[Passkey] Registration");
        console.log("Context:", {
            username,
            userId,
            hostname: window.location.hostname,
            secureContext: window.isSecureContext
        });

        if (!window.isSecureContext) {
            console.error("WebAuthn requires a secure context (HTTPS or localhost).");
            console.groupEnd();
            throw new Error("Insecure Context: Passkeys require HTTPS.");
        }

        // 1. Challenge
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);

        // 2. User Info
        const userHandle = new TextEncoder().encode(userId);

        // 3. Create Credential Options
        const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
            challenge: challenge,
            rp: {
                name: "Onyx",
                id: window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname
            },
            user: {
                id: userHandle,
                name: username,
                displayName: username,
            },
            pubKeyCredParams: [
                { alg: -7, type: "public-key" }, // ES256
                { alg: -257, type: "public-key" }, // RS256
            ],
            authenticatorSelection: {
                // Relaxed: Removing authenticatorAttachment: "platform" allows the browser 
                // to offer Windows Hello OR external keys (YubiKey) if platform is unavailable/disabled.
                // We'll let the platform decide its "cross-platform" preference.
                userVerification: "required", // Force PIN/Biometrics
                residentKey: "required", // Discoverable Credential
                requireResidentKey: true,
            },
            timeout: 60000,
            attestation: "none",
        };

        console.log("Options:", publicKeyCredentialCreationOptions);

        try {
            // 4. Create Credential
            console.log("Calling navigator.credentials.create...");
            const credential = await navigator.credentials.create({
                publicKey: publicKeyCredentialCreationOptions,
            }) as PublicKeyCredential;

            if (!credential) {
                const err = new Error("Credential creation returned null.");
                console.error(err);
                throw err;
            }

            console.log("Credential Created Successfully:", credential);

            const response = credential.response as AuthenticatorAttestationResponse;
            const transports = typeof response.getTransports === 'function' ? response.getTransports() : [];

            const result = {
                id: credential.id,
                rawId: this.bufferToBase64URL(credential.rawId),
                response: {
                    clientDataJSON: this.bufferToBase64URL(response.clientDataJSON),
                    attestationObject: this.bufferToBase64URL(response.attestationObject),
                    transports: transports
                },
                type: credential.type,
                user_id: userId,
            };

            console.log("Final Registration Data:", result);
            console.groupEnd();
            return result;
        } catch (err: any) {
            console.error("Registration Phase Failed:", err.name, err.message);
            if (err.name === 'NotAllowedError') {
                console.warn("User cancelled the prompt or permission denied.");
            } else if (err.name === 'SecurityError') {
                console.warn("RP ID mismatch or insecure origin.");
            }
            console.groupEnd();
            throw err;
        }
    }

    // --- AUTHENTICATION ---

    /**
     * Authenticates using a Passkey.
     * If no userId is provided, it attempts to "Discover" the user (Resident Key).
     */
    static async authenticate(): Promise<any> {
        console.group("[Passkey] Authentication");
        console.log("Context:", {
            hostname: window.location.hostname,
            secureContext: window.isSecureContext
        });

        if (!window.isSecureContext) {
            console.error("WebAuthn requires a secure context.");
            console.groupEnd();
            throw new Error("Insecure Context: Passkeys require HTTPS.");
        }

        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);

        const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
            challenge: challenge,
            rpId: window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname,
            userVerification: "required",
            // allowCredentials: [] // Empty = Discoverable Credential (Resident Key)
        };

        console.log("Auth Options:", publicKeyCredentialRequestOptions);

        try {
            console.log("Calling navigator.credentials.get...");
            const credential = await navigator.credentials.get({
                publicKey: publicKeyCredentialRequestOptions,
            }) as PublicKeyCredential;

            if (!credential) {
                const err = new Error("Authentication returned null.");
                console.groupEnd();
                throw err;
            }

            console.log("Authentication Successful:", credential);

            const response = credential.response as AuthenticatorAssertionResponse;
            const result = {
                id: credential.id,
                rawId: this.bufferToBase64URL(credential.rawId),
                response: {
                    clientDataJSON: this.bufferToBase64URL(response.clientDataJSON),
                    authenticatorData: this.bufferToBase64URL(response.authenticatorData),
                    signature: this.bufferToBase64URL(response.signature),
                    userHandle: response.userHandle
                        ? this.bufferToBase64URL(response.userHandle)
                        : null
                },
                type: credential.type
            };

            console.log("Final Auth Response Data:", result);
            console.groupEnd();
            return result;
        } catch (err: any) {
            console.error("Authentication Phase Failed:", err.name, err.message);
            console.groupEnd();
            throw err;
        }
    }
}

