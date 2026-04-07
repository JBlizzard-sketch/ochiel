import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
// In AI Studio, we'll try to initialize with default credentials or mock for the demo
try {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "gen-lang-client-0677506725"
  });
} catch (e) {
  console.error("Firebase Admin Init Error:", e);
}

const db = admin.firestore();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- PesaPal Integration Endpoints ---

  // PesaPal Callback (IPN)
  app.post("/api/payments/pesapal-callback", async (req, res) => {
    const { OrderTrackingId, OrderMerchantReference, OrderNotificationType } = req.body;
    console.log("PesaPal Callback Received:", { OrderTrackingId, OrderMerchantReference, OrderNotificationType });
    
    try {
      // 1. Verify transaction status with PesaPal API (Mocked here)
      // const status = await verifyPesaPalTransaction(OrderTrackingId);
      const status = "completed"; // Mocked status

      // 2. Update Firestore payment record
      const paymentsRef = db.collection("payments");
      const snapshot = await paymentsRef.where("pesapalMerchantReference", "==", OrderMerchantReference).get();
      
      if (!snapshot.empty) {
        const paymentDoc = snapshot.docs[0];
        await paymentDoc.ref.update({
          status: status,
          pesapalTrackingId: OrderTrackingId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 3. Update associated case status if needed
        const paymentData = paymentDoc.data();
        if (status === "completed" && paymentData.caseId) {
          await db.collection("cases").doc(paymentData.caseId).update({
            status: "active",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }

      res.json({ status: "ok", message: "IPN Processed Successfully" });
    } catch (error) {
      console.error("IPN Processing Error:", error);
      res.status(500).json({ status: "error", message: "Failed to process IPN" });
    }
  });

  // Get PesaPal Auth Token (Mock)
  app.get("/api/payments/token", (req, res) => {
    res.json({ token: "mock_pesapal_token_" + Date.now() });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
