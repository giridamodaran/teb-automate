import { executeLeadWebhookAutomation } from "../src/lib/automation/teb-lead-service";

async function runTestExecution() {
  console.log("🚀 Testing full TEB Lead webhook execution with SaveLeadDetail DTO...");

  const payload = {
    phone: "+919876543210",
    name: "Test Lead - WATI Bot Verified",
    email: "test.wati.lead@example.com",
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

  const res = await executeLeadWebhookAutomation(payload);
  console.log("\n==========================================");
  console.log("EXECUTION RESULT:", JSON.stringify(res, null, 2));
  console.log("==========================================");
}

runTestExecution();
