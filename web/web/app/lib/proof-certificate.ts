import QRCode from "qrcode";

export type ProofCertificateData = {
  challengeId: string;
  title: string;
  status: "validated" | "contested";
  requesterDid: string;
  workerDid: string;
  validatorCount: number;
  model: string;
  computeGflop: number;
  runtimeSeconds: number;
  resultSha256: string;
  receiptSha256: string;
  room: string;
};

const WIDTH = 1600;
const HEIGHT = 1000;

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The work receipt QR code could not be rendered."));
    image.src = source;
  });
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The work receipt PNG could not be created.")), "image/png");
  });
}

function fitText(context: CanvasRenderingContext2D, text: string, maximumWidth: number, initialSize: number): void {
  let size = initialSize;
  do {
    context.font = `800 ${size}px Arial, sans-serif`;
    if (context.measureText(text).width <= maximumWidth) return;
    size -= 2;
  } while (size >= 24);
}

function splitHash(hash: string): [string, string] {
  return [hash.slice(0, 32), hash.slice(32)];
}

export async function createProofCertificatePng(data: ProofCertificateData): Promise<Blob> {
  if (!/^poui-[0-9a-f]{12}$/.test(data.challengeId)) throw new Error("The work receipt challenge identity is invalid.");
  if (!/^[0-9a-f]{64}$/.test(data.resultSha256) || !/^[0-9a-f]{64}$/.test(data.receiptSha256)) {
    throw new Error("The work receipt fingerprints are invalid.");
  }
  if (!data.requesterDid.startsWith("did:key:z") || !data.workerDid.startsWith("did:key:z")) {
    throw new Error("The work receipt DIDs are invalid.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create the work receipt image.");

  const background = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#020805");
  background.addColorStop(0.52, "#07150c");
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

  const statusColor = data.status === "validated" ? "#23f77a" : "#f3c66b";
  context.strokeStyle = statusColor;
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
  context.fillText("PROOF OF USEFUL INFERENCE RECEIPT", 187, 154);

  context.textAlign = "right";
  context.fillStyle = statusColor;
  context.font = "700 19px Courier New, monospace";
  context.fillText(data.status.toUpperCase(), 1504, 112);
  context.fillStyle = "#82a98f";
  context.font = "16px Courier New, monospace";
  context.fillText(`${data.validatorCount} VALIDATOR DECISION(S)`, 1504, 140);
  context.textAlign = "left";

  context.fillStyle = "#6c9d7d";
  context.font = "700 18px Courier New, monospace";
  context.fillText("USEFUL WORK CHALLENGE", 88, 242);
  context.fillStyle = "#effff5";
  fitText(context, data.title, 1010, 52);
  context.fillText(data.title, 88, 302);
  context.fillStyle = "#23f77a";
  context.font = "700 25px Courier New, monospace";
  context.fillText(`${data.challengeId}  /  ROOM ${data.room}`, 88, 350);

  const rows = [
    ["REQUESTER DID", data.requesterDid],
    ["WORKER DID", data.workerDid],
    ["MODEL", data.model],
    ["DECLARED COMPUTE", `${data.computeGflop.toLocaleString()} GFLOP`],
    ["RUNTIME", `${data.runtimeSeconds.toLocaleString()} SECONDS`],
  ];
  let y = 414;
  for (const [label, value] of rows) {
    context.fillStyle = "#6c9d7d";
    context.font = "700 16px Courier New, monospace";
    context.fillText(label, 88, y);
    context.fillStyle = "#dfffea";
    context.font = "19px Courier New, monospace";
    context.fillText(value, 300, y);
    y += 48;
  }

  const [resultA, resultB] = splitHash(data.resultSha256);
  const [receiptA, receiptB] = splitHash(data.receiptSha256);
  context.fillStyle = "#6c9d7d";
  context.font = "700 17px Courier New, monospace";
  context.fillText("RESULT SHA-256", 88, 698);
  context.fillStyle = "#effff5";
  context.font = "21px Courier New, monospace";
  context.fillText(resultA, 88, 733);
  context.fillText(resultB, 88, 763);

  context.fillStyle = "#6c9d7d";
  context.font = "700 17px Courier New, monospace";
  context.fillText("PUBLIC RECEIPT SHA-256", 88, 816);
  context.fillStyle = "#effff5";
  context.font = "21px Courier New, monospace";
  context.fillText(receiptA, 88, 851);
  context.fillText(receiptB, 88, 881);

  const qrDataUrl = await QRCode.toDataURL("https://neoncore.space/#proof", {
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
  context.fillText("OPEN PROOF LAB", 1364, 566);
  context.fillStyle = "#7fac8e";
  context.font = "17px Arial, sans-serif";
  context.fillText("Verify with the matching JSON receipt", 1364, 594);
  context.textAlign = "left";

  context.fillStyle = "rgba(8, 28, 17, 0.92)";
  context.fillRect(88, 910, 1424, 44);
  context.strokeStyle = "rgba(35, 247, 122, 0.28)";
  context.strokeRect(88, 910, 1424, 44);
  context.fillStyle = "#a8d9b8";
  context.font = "16px Arial, sans-serif";
  context.fillText("Independent experiment only. This is not an official FLOP protocol record, payment, mining result, token, or reward promise.", 112, 938);

  context.fillStyle = "#5f8d70";
  context.font = "15px Courier New, monospace";
  context.fillText("SIGNED DID WORK RECORD", 88, 980);
  context.textAlign = "right";
  context.fillText("NEONCORE.SPACE  /  INDEPENDENT TECHNOCORE COMMUNITY TOOL", 1512, 980);
  context.textAlign = "left";

  return pngBlob(canvas);
}

export function proofCertificateFilename(data: ProofCertificateData): string {
  return `${data.challengeId}-public-work-certificate.png`;
}

