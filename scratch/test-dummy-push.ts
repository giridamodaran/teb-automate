import { executeLeadWebhookAutomation } from "../src/lib/automation/teb-lead-service";

async function runLiveTest() {
  console.log("🚀 Running live TEB Lead push test with credentials from .env.local...");

  const dummyPayload = {
    phone: "+919876543210",
    name: "Test Lead - WATI Bot Dummy",
    email: "dummy.lead@example.com",
    product: "Water Heater Heat Pump 300L",
    electricsupply: "3 Phase 415V",
    family_size: "4-6 Members",
    product_application: "Residential Solar Hybrid",
    talk_or_checkprice: "Check Price Only",
    checkprice: "RS 45000",
    connect_day: "Tomorrow Morning",
    connect_confirmation: "Confirmed",
    capacity_confirmation: "300 Liters Confirmed",
    connect_confirmation_heat: "Heat Pump Ready",
    price_confirmation_heat: "Price Approved",
  };

  const result = await executeLeadWebhookAutomation(dummyPayload);
  console.log("\n==========================================");
  console.log("SUCCESS RESULT:", JSON.stringify(result, null, 2));
  console.log("==========================================");
}

runLiveTest();
