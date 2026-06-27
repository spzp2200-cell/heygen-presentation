import fs from 'fs';
import path from 'path';

// .env ファイルから API キーを読み込む
const envPath = path.resolve('.env');
let apiKey = '';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/HEYGEN_API_KEY=["']?([^"'\r\n]+)["']?/);
  if (match) {
    apiKey = match[1];
  }
}

if (!apiKey) {
  console.error("エラー: プロジェクトのルートにある .env ファイルに HEYGEN_API_KEY が見つかりません。");
  process.exit(1);
}

// 今回のシーンの設定（アバターID、音声ファイル、出力動画ファイル）
const scenes = [
  {
    name: '① イントロ (平岡様アバター)',
    avatarId: '62afda92c6da4ee2bedcfef40f5fd4d6',
    audioFile: 'interactive-presentation/assets/narration_intro.mp3',
    outputFile: 'interactive-presentation/assets/avatar_intro.webm'
  },
  {
    name: '② ルートA (秘書女性 - アバター5解説)',
    avatarId: '33d10dc09cb641c09fea19de66897c83',
    audioFile: 'interactive-presentation/assets/narration_a.mp3',
    outputFile: 'interactive-presentation/assets/avatar_a.webm'
  },
  {
    name: '③ ルートB (秘書女性 - HyperFrames解説)',
    avatarId: '5e5533b46315429a8f5b498082e69fc2',
    audioFile: 'interactive-presentation/assets/narration_b.mp3',
    outputFile: 'interactive-presentation/assets/avatar_b.webm'
  }
];

// HeyGenにオーディオファイルをアップロードしてasset_idを取得する関数
async function uploadAudio(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`音声ファイルが見つかりません: ${filePath}`);
  }

  console.log(`[オーディオアップロード] ${path.basename(filePath)} を送信中...`);
  
  const fileBuffer = fs.readFileSync(filePath);
  const fileBlob = new Blob([fileBuffer], { type: 'audio/mpeg' });
  const formData = new FormData();
  formData.append('file', fileBlob, path.basename(filePath));

  const response = await fetch('https://api.heygen.com/v3/assets', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey
    },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`アップロード失敗: ${response.status} - ${errText}`);
  }

  const resJson = await response.json();
  console.log("アップロードレスポンス詳細:", JSON.stringify(resJson));
  const assetId = resJson.data.asset_id || resJson.data.id;
  console.log(`[オーディオアップロード] 完了 (Asset ID: ${assetId})`);
  return assetId;
}

// 透過アバター動画（WebM）の生成をリクエストする関数
async function createAvatarVideo(avatarId, audioAssetId) {
  console.log(`[動画生成リクエスト] アバターID ${avatarId} で動画の生成をリクエスト中...`);

  const response = await fetch('https://api.heygen.com/v3/videos', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'avatar',
      avatar_id: avatarId,
      audio_asset_id: audioAssetId,
      output_format: "webm" // 背景透過用のWebMを指定
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`動画生成リクエスト失敗: ${response.status} - ${errText}`);
  }

  const resJson = await response.json();
  const videoId = resJson.data.video_id;
  console.log(`[動画生成リクエスト] 受理されました (Video ID: ${videoId})`);
  return videoId;
}

// 動画のレンダリング完了を監視してダウンロードする関数
async function pollAndDownload(videoId, outputPath) {
  console.log(`[ステータス監視] 動画のレンダリング完了を待機しています...`);
  let videoUrl = null;

  while (true) {
    const statusRes = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
      headers: {
        'x-api-key': apiKey
      }
    });

    if (!statusRes.ok) {
      console.log(`\n警告: ステータス取得エラー (リトライします...)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    const statusData = await statusRes.json();
    const status = statusData.data.status;

    if (status === 'completed') {
      videoUrl = statusData.data.video_url;
      break;
    } else if (status === 'failed' || status === 'error') {
      throw new Error(`動画の生成に失敗しました: ${statusData.data.error.message}`);
    }

    // 進行状況の進捗表示
    process.stdout.write(".");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log(`\n[ダウンロード] 動画が完成しました。ダウンロード中...`);
  const dlRes = await fetch(videoUrl);
  const buffer = await dlRes.arrayBuffer();
  
  // 保存先ディレクトリが存在することを確認
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, Buffer.from(buffer));
  console.log(`[完了] 透過アバター動画を保存しました: ${outputPath}\n`);
}

// メインの実行処理
async function run() {
  console.log("=================================================");
  console.log(" HeyGen 透過アバター動画 自動生成スクリプト");
  console.log("=================================================\n");

  for (const scene of scenes) {
    try {
      console.log(`--- シーン処理開始: ${scene.name} ---`);
      
      // 1. 音声アセットのアップロード
      const audioAssetId = await uploadAudio(scene.audioFile);
      
      // 2. アバター動画の生成リクエスト
      const videoId = await createAvatarVideo(scene.avatarId, audioAssetId);
      
      // 3. 完了待ち & ダウンロード
      await pollAndDownload(videoId, scene.outputFile);
      
    } catch (error) {
      console.error(`\n❌ [エラー] ${scene.name} の生成中に問題が発生しました: ${error.message}\n`);
    }
  }

  console.log("=================================================");
  console.log(" すべてのアバターアセットの生成処理が完了しました！");
  console.log("=================================================");
}

run();
