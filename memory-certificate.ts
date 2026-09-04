import QRCode from "qrcode";

export type MemoryCertificateData = {
  passportId: string;
  version: number;
  agentName: string;
  purpose: string;
  publicSummary: string;
  ownerDid: string;
  privatePassportSha256: string;
  publicCardSha256: string;
  updatedAt: string;
};

const WIDTH = 1600;
const HEIGHT = 1000;

function fitText(context: CanvasRenderingContext2D, text: string, maximumWidth: number, initialSize: number, weight = 700): void {
  let size = initialSize;
  do {
    context.font = `${weight} ${size}px Arial, sans-serif`;
    if (context.measureText(text).width <= maximumWidth) return;
    size -= 2;
  } while (size >= 24);
}

function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maximumWidth: number, lineHeight: number, maximumLines: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maximumWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maximumLines - 1) break;
  }
  if (line && lines.length < maximumLines) lines.push(line);
  if (words.length && lines.length === maximumLines) {
    while (context.measureText(`${lines[maximumLines - 1]}…`).width > maximumWidth) {
      lines[maximumLines - 1] = lines[maximumLines - 1].slice(0, -1);
    }
    lines[maximumLines - 1] += "…";
  }
  for (const value of lines) {
    context.fillText(value, x, y);
    y += lineHeight;
  }
  return y;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The certificate QR code could not be rendered."));
    image.src = source;
  });
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The certificate PNG could not be created.")), "image/png");
  });
}

function splitHash(hash: string): [string, string] {
  return [hash.slice(0, 32), hash.slice(32)];
}

export async function createMemoryCertificatePng(data: MemoryCertificateData): Promise<Blob> {
  if (!/^mp-[0-9a-f]{16}$/.test(data.passportId) || !Number.isInteger(data.version) || data.version < 1) {
    throw new Error("The public certificate passport identity is invalid.");
  }
  if (!/^[0-9a-f]{64}$/.test(data.privatePassportSha256) || !/^[0-9a-f]{64}$/.test(data.publicCardSha256)) {
    throw new Error("The public certificate fingerprints are invalid.");
  }
  if (!data.ownerDid.startsWith("did:key:z")) throw new Error("The public certificate owner DID is invalid.");

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create the certificate image.");

  const background = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#020805");
  background.addColorStop(0.55, "#06120b");
  background.addColorStop(1, "#010503");
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.strokeStyle = "rgba(35, 247, 122, 0.07)";
  context.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x += 50) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, HEIGHT); context.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 50) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(WIDTH, y); context.stroke();
  }

  context.strokeStyle = "#1ee873";
  context.lineWidth = 3;
  context.strokeRect(38, 38, WIDTH - 76, HEIGHT - 76);
  context.strokeStyle = "rgba(35, 247, 122, 0.3)";
  context.lineWidth = 1;
  context.strokeRect(52, 52, WIDTH - 104, HEIGHT - 104);

  context.fillStyle = "#23f77a";
  context.fillRect(88, 88, 70, 70);
  context.fillStyle = "#031008";
  context.font = "800 30px Arial, sans-serif";
  context.fillText("NC", 100, 134);

  context.fillStyle = "#effff5";
  context.font = "800 52px Arial, sans-serif";
  context.fillText("NEONCORE", 184, 126);
  context.fillStyle = "#70a986";
  context.font = "600 18px Courier New, monospace";
  context.fillText("PUBLIC MEMORY PASSPORT CERTIFICATE", 187, 154);

  context.textAlign = "right";
  context.fillStyle = "#23f77a";
  context.font = "700 17px Courier New, monospace";
  context.fillText("SAFE TO SHARE", 1504, 112);
  context.fillStyle = "#82a98f";
  context.font = "16px Courier New, monospace";
  context.fillText(`VERSION ${data.version}`, 1504, 140);
  context.textAlign = "left";

  context.fillStyle = "#6c9d7d";
  context.font = "700 18px Courier New, monospace";
  context.fillText("AGENT", 88, 244);
  context.fillStyle = "#effff5";
  fitText(context, data.agentName, 1010, 60);
  context.fillText(data.agentName, 88, 306);

  context.fillStyle = "#6c9d7d";
  context.font = "700 18px Courier New, monospace";
  context.fillText("PASSPORT", 88, 368);
  context.fillStyle = "#23f77a";
  context.font = "700 27px Courier New, monospace";
  context.fillText(`${data.passportId}  /  VERSION ${data.version}`, 88, 407);

  context.fillStyle = "#6c9d7d";
  context.font = "700 18px Courier New, monospace";
  context.fillText("PUBLIC PURPOSE", 88, 468);
  context.fillStyle = "#dfffea";
  context.font = "25px Arial, sans-serif";
  const purposeBottom = wrapText(context, data.purpose || data.publicSummary || "Portable encrypted agent memory.", 88, 510, 1030, 34, 2);

  context.fillStyle = "#6c9d7d";
  context.font = "700 18px Courier New, monospace";
  context.fillText("OWNER DID", 88, purposeBottom + 28);
  context.fillStyle = "#b8e6c8";
  context.font = "20px Courier New, monospace";
  context.fillText(data.ownerDid, 88, purposeBottom + 64);

  const hashY = 680;
  const [privateHashA, privateHashB] = splitHash(data.privatePassportSha256);
  const [publicHashA, publicHashB] = splitHash(data.publicCardSha256);
  context.fillStyle = "#6c9d7d";
  context.font = "700 17px Courier New, monospace";
  context.fillText("PRIVATE PASSPORT SHA-256, FINGERPRINT ONLY", 88, hashY);
  context.fillStyle = "#effff5";
  context.font = "21px Courier New, monospace";
  context.fillText(privateHashA, 88, hashY + 35);
  context.fillText(privateHashB, 88, hashY + 65);

  context.fillStyle = "#6c9d7d";
  context.font = "700 17px Courier New, monospace";
  context.fillText("PUBLIC CARD SHA-256", 88, hashY + 118);
  context.fillStyle = "#effff5";
  context.font = "21px Courier New, monospace";
  context.fillText(publicHashA, 88, hashY + 153);
  context.fillText(publicHashB, 88, hashY + 183);

  const qrDataUrl = await QRCode.toDataURL("https://neoncore.space/#memory", {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 300,
    color: { dark: "#04110aff", light: "#effff5ff" },
  });
  const qrImage = await loadImage(qrDataUrl);
  context.fillStyle = "#effff5";
  context.fillRect(1212, 226, 304, 304);
  context.drawImage(qrImage, 1214, 228, 300, 300);
  context.fillStyle = "#23f77a";
  context.font = "700 18px Courier New, monospace";
  context.textAlign = "center";
  context.fillText("OPEN NEONCORE", 1364, 566);
  context.fillStyle = "#7fac8e";
  context.font = "17px Arial, sans-serif";
  context.fillText("Verify with the matching public card", 1364, 594);
  context.textAlign = "left";

  context.fillStyle = "rgba(8, 28, 17, 0.92)";
  context.fillRect(88, 870, 1424, 62);
  context.strokeStyle = "rgba(35, 247, 122, 0.28)";
  context.strokeRect(88, 870, 1424, 62);
  context.fillStyle = "#a8d9b8";
  context.font = "18px Arial, sans-serif";
  context.fillText("This image contains public profile data and fingerprints only. It contains no private memory, password, private key, or ciphertext.", 112, 908);

  context.fillStyle = "#5f8d70";
  context.font = "15px Courier New, monospace";
  context.fillText(`UPDATED ${data.updatedAt || "UNKNOWN"}`, 88, 962);
  context.textAlign = "right";
  context.fillText("NEONCORE.SPACE  /  INDEPENDENT TECHNOCORE COMMUNITY TOOL", 1512, 962);
  context.textAlign = "left";

  return pngBlob(canvas);
}

export function memoryCertificateFilename(data: MemoryCertificateData): string {
  return `${data.passportId}-v${data.version}-public-certificate.png`;
}
