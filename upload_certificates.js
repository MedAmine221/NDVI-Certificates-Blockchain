const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// Load certificates and CIDs JSON files
const certs = JSON.parse(fs.readFileSync("all_certificates.json", "utf8"));
const cidCertificates = JSON.parse(fs.readFileSync("CID-CERTIFICATES.json", "utf8"));

if (!Array.isArray(certs)) {
  console.error("all_certificates.json is not an array or invalid!");
  process.exit(1);
}
if (!Array.isArray(cidCertificates)) {
  console.error("CID-CERTIFICATES.json is not an array or invalid!");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider("https://eth-sepolia.g.alchemy.com/v2/0RZR25pxrRW2gd45iHxMP");
const PRIVATE_KEY = "0xd76f296396a6de7cc8e6e7aa560332b6de993c00924c0e00e5d4ef2c0984ca56";
const CONTRACT_ADDRESS = "0xfbed63872f061db1dcfa16598094cb5723fcfa77";

const abi = [
  "function addOrUpdateCertificate(string terrainId, int256 lat, int256 lon, int256 ndvi, string status, string date) public",
  "function mintNFTForSuitableLand(string terrainId, string cidPdf) public returns (uint256)",
  "function getCertificate(string terrainId) public view returns (string, int, int, int, string, string, string, bool, uint256)",
  // Add Transfer event to decode mint event logs properly
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
const iface = new ethers.Interface(abi); // for manual log decoding

// Helper to check if NFT already minted on-chain
async function checkIfMinted(terrainId) {
  const certData = await contract.getCertificate(terrainId);
  // certData = [terrainId, lat, lon, ndvi, status, date, cidPdf, mintedNFT, tokenId]
  return certData[7]; // mintedNFT boolean
}

(async () => {
  for (const cert of certs) {
    const lat = Math.round(cert.center_lat * 1e6);
    const lon = Math.round(cert.center_lon * 1e6);
    const ndvi = Math.round(cert.mean_ndvi * 1e4);

    try {
      console.log(`📤 Uploading certificate data for terrain ${cert.terrain_id}...`);

      const normalizedStatus = cert.status.toLowerCase().trim();

      // Add or update certificate data for the terrain
      const tx1 = await contract.addOrUpdateCertificate(
        cert.terrain_id,
        lat,
        lon,
        ndvi,
        normalizedStatus,
        cert.date
      );
      await tx1.wait();
      console.log(`✅ Certificate data added for terrain ${cert.terrain_id}`);

      if (normalizedStatus === "suitable") {
        // Check if NFT already minted on-chain
        const alreadyMinted = await checkIfMinted(cert.terrain_id);
        if (alreadyMinted) {
          console.log(`⏭️ NFT already minted for terrain ${cert.terrain_id}, skipping mint.`);
          continue;
        }

        // Find CID for this terrain
        const cidEntry = cidCertificates.find(c => c.terrain_id === cert.terrain_id);
        if (!cidEntry) {
          console.warn(`⚠️ CID not found for suitable terrain ${cert.terrain_id}, skipping NFT mint.`);
          continue;
        }

        const cidPdf = cidEntry.cid;

        // Mint NFT using existing CID
        const tx2 = await contract.mintNFTForSuitableLand(cert.terrain_id, cidPdf);
        const receipt = await tx2.wait();

        // Defensive: check receipt.events first
        if (!receipt.events || receipt.events.length === 0) {
          console.warn(`⚠️ No events found in transaction receipt for terrain ${cert.terrain_id}, trying manual log decoding...`);

          let tokenId = "unknown";

          for (const log of receipt.logs) {
            try {
              const parsedLog = iface.parseLog(log);
              if (parsedLog.name === "Transfer") {
                tokenId = parsedLog.args.tokenId.toString();
                console.log(`✅ NFT minted for terrain ${cert.terrain_id} with tokenId ${tokenId} (decoded manually)`);
                break;
              }
            } catch {
              // ignore if log can't be parsed
            }
          }

          if (tokenId === "unknown") {
            console.warn(`⚠️ Could not decode mint event logs for terrain ${cert.terrain_id}`);
          }
          continue;
        }

        // If events exist, find Transfer event normally
        const mintEvent = receipt.events.find(event => event.event === "Transfer");
        let tokenId = "unknown";

        if (mintEvent && mintEvent.args) {
          if (Array.isArray(mintEvent.args)) {
            tokenId = mintEvent.args[2].toString();
          } else if ("tokenId" in mintEvent.args) {
            tokenId = mintEvent.args.tokenId.toString();
          }
        } else {
          console.warn(`⚠️ Transfer event not found in transaction receipt for terrain ${cert.terrain_id}`);
        }

        console.log(`✅ NFT minted for terrain ${cert.terrain_id} with tokenId ${tokenId} and CID ${cidPdf}`);
      } else {
        console.log(`⏭️ Terrain ${cert.terrain_id} not suitable, skipping NFT mint.`);
      }
    } catch (err) {
      console.error(`❌ Error processing terrain ${cert.terrain_id}:`, err.message);
    }
  }
  console.log("🚀 All done!");
})();
