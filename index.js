require("dotenv").config();
const express = require("express");
const multer = require("multer");
const AWS = require("aws-sdk");
const mysql = require("mysql2");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// MySQL Connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
  } else {
    console.log("✅ Database connected successfully");
  }
});

// AWS S3 Config
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();
const upload = multer({ dest: "uploads/" });

/* ===================== HOMEPAGE - UPLOAD FORM ===================== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

/* ===================== FILES LIST PAGE ===================== */
app.get("/files", (req, res) => {
  db.query("SELECT * FROM files ORDER BY id DESC", (err, results) => {
    if (err) {
      console.error("Error fetching files:", err);
      return res
        .status(500)
        .send(generateErrorPage("Gagal mengambil data file"));
    }

    res.send(generateFilesPage(results));
  });
});

/* ===================== CREATE ===================== */
app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  const description = req.body.description || "No description";

  if (!file) {
    return res.status(400).send(generateErrorPage("File tidak dipilih"));
  }

  const fileContent = fs.readFileSync(file.path);

  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: file.originalname,
    Body: fileContent,
    ContentType: file.mimetype,
  };

  s3.upload(params, function (err, data) {
    if (err) {
      console.error("S3 Upload Error:", err);
      fs.unlinkSync(file.path);
      return res.status(500).send(generateErrorPage("Gagal upload ke S3"));
    }

    db.query(
      "INSERT INTO files (filename, description) VALUES (?, ?)",
      [file.originalname, description],
      function (error, results) {
        if (error) {
          console.error("Database Insert Error:", error);
          fs.unlinkSync(file.path);
          return res
            .status(500)
            .send(generateErrorPage("Gagal menyimpan ke database"));
        }

        fs.unlinkSync(file.path);
        res.send(generateSuccessPage("File berhasil diupload!", "/files"));
      },
    );
  });
});

/* ===================== UPDATE ===================== */
app.get("/edit/:id", (req, res) => {
  const id = req.params.id;
  db.query("SELECT * FROM files WHERE id = ?", [id], (err, result) => {
    if (err || result.length === 0) {
      return res.status(404).send(generateErrorPage("File tidak ditemukan"));
    }

    const file = result[0];
    res.send(generateEditPage(file));
  });
});

app.post("/update/:id", (req, res) => {
  const id = req.params.id;
  const description = req.body.description;

  db.query(
    "UPDATE files SET description = ? WHERE id = ?",
    [description, id],
    (err, result) => {
      if (err) {
        console.error("Update Error:", err);
        return res.status(500).send(generateErrorPage("Gagal mengupdate file"));
      }
      res.send(generateSuccessPage("Deskripsi berhasil diupdate!", "/files"));
    },
  );
});

/* ===================== DELETE ===================== */
app.get("/delete/:id", (req, res) => {
  const id = req.params.id;

  db.query("SELECT * FROM files WHERE id = ?", [id], (err, result) => {
    if (err || result.length === 0) {
      return res.status(404).send(generateErrorPage("File tidak ditemukan"));
    }

    const filename = result[0].filename;

    // Hapus dari S3
    s3.deleteObject(
      {
        Bucket: process.env.S3_BUCKET,
        Key: filename,
      },
      function (err, data) {
        if (err) {
          console.error("S3 Delete Error:", err);
          return res
            .status(500)
            .send(generateErrorPage("Gagal menghapus file dari S3"));
        }

        // Hapus dari DB
        db.query("DELETE FROM files WHERE id = ?", [id], (err2, result2) => {
          if (err2) {
            console.error("Database Delete Error:", err2);
            return res
              .status(500)
              .send(generateErrorPage("Gagal menghapus dari database"));
          }
          res.send(generateSuccessPage("File berhasil dihapus!", "/files"));
        });
      },
    );
  });
});

/* ===================== HELPER FUNCTIONS - HTML GENERATORS ===================== */

function generateFilesPage(files) {
  const fileRows = files
    .map(
      (file) => `
    <tr>
      <td>${file.id}</td>
      <td><i class="fas fa-file"></i> ${file.filename}</td>
      <td>${file.description || "-"}</td>
      <td>
        <a href="/edit/${file.id}" class="btn-edit">
          <i class="fas fa-edit"></i> Edit
        </a>
        <a href="/delete/${file.id}" class="btn-delete" onclick="return confirm('Yakin hapus file ini?')">
          <i class="fas fa-trash"></i> Hapus
        </a>
      </td>
    </tr>
  `,
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Daftar File - Cloud Storage</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 40px 20px;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
        }

        .header {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 20px;
          padding: 30px;
          margin-bottom: 30px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .header h1 {
          color: #2d3748;
          font-size: 28px;
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .header h1 i {
          font-size: 32px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .btn-upload {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 12px 24px;
          border-radius: 10px;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          transition: all 0.3s ease;
          box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }

        .btn-upload:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
        }

        .table-container {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 20px;
          padding: 30px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          overflow-x: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        thead {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        th {
          padding: 15px;
          text-align: left;
          font-weight: 600;
          text-transform: uppercase;
          font-size: 14px;
          letter-spacing: 0.5px;
        }

        th:first-child {
          border-radius: 10px 0 0 0;
        }

        th:last-child {
          border-radius: 0 10px 0 0;
        }

        td {
          padding: 15px;
          border-bottom: 1px solid #e2e8f0;
          color: #2d3748;
        }

        tr:last-child td {
          border-bottom: none;
        }

        tbody tr {
          transition: background 0.2s ease;
        }

        tbody tr:hover {
          background: #f7fafc;
        }

        .btn-edit, .btn-delete {
          padding: 8px 16px;
          border-radius: 8px;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.3s ease;
          margin-right: 8px;
        }

        .btn-edit {
          background: #48bb78;
          color: white;
        }

        .btn-edit:hover {
          background: #38a169;
          transform: translateY(-2px);
        }

        .btn-delete {
          background: #f56565;
          color: white;
        }

        .btn-delete:hover {
          background: #e53e3e;
          transform: translateY(-2px);
        }

        .empty-state {
          text-align: center;
          padding: 60px 20px;
          color: #718096;
        }

        .empty-state i {
          font-size: 64px;
          color: #cbd5e0;
          margin-bottom: 20px;
        }

        .empty-state h2 {
          color: #4a5568;
          margin-bottom: 10px;
        }

        @media (max-width: 768px) {
          .header {
            flex-direction: column;
            gap: 20px;
            text-align: center;
          }

          table {
            font-size: 14px;
          }

          th, td {
            padding: 10px;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>
            <i class="fas fa-folder-open"></i>
            Daftar File
          </h1>
          <a href="/" class="btn-upload">
            <i class="fas fa-cloud-upload-alt"></i>
            Upload File Baru
          </a>
        </div>

        <div class="table-container">
          ${
            files.length > 0
              ? `
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nama File</th>
                  <th>Deskripsi</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                ${fileRows}
              </tbody>
            </table>
          `
              : `
            <div class="empty-state">
              <i class="fas fa-inbox"></i>
              <h2>Belum ada file</h2>
              <p>Upload file pertama Anda untuk memulai</p>
            </div>
          `
          }
        </div>
      </div>
    </body>
    </html>
  `;
}

function generateEditPage(file) {
  return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Edit File - Cloud Storage</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }

        .container {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          padding: 40px;
          max-width: 500px;
          width: 100%;
        }

        .header {
          text-align: center;
          margin-bottom: 35px;
        }

        .header i {
          font-size: 48px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 15px;
        }

        .header h1 {
          color: #2d3748;
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 8px;
        }

        .file-info {
          background: #f7fafc;
          padding: 15px;
          border-radius: 10px;
          margin-bottom: 25px;
          border-left: 4px solid #667eea;
        }

        .file-info strong {
          color: #4a5568;
        }

        .file-info span {
          color: #2d3748;
          word-break: break-all;
        }

        .form-group {
          margin-bottom: 25px;
        }

        .form-group label {
          display: block;
          color: #4a5568;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .form-group label i {
          color: #667eea;
        }

        .form-group input {
          width: 100%;
          padding: 14px 16px;
          border: 2px solid #e2e8f0;
          border-radius: 12px;
          font-size: 15px;
          font-family: 'Inter', sans-serif;
          transition: all 0.3s ease;
          color: #2d3748;
        }

        .form-group input:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .buttons {
          display: flex;
          gap: 12px;
        }

        .btn {
          flex: 1;
          padding: 14px;
          border: none;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-decoration: none;
        }

        .btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
        }

        .btn-secondary {
          background: #e2e8f0;
          color: #4a5568;
        }

        .btn-secondary:hover {
          background: #cbd5e0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <i class="fas fa-edit"></i>
          <h1>Edit Deskripsi</h1>
        </div>

        <div class="file-info">
          <strong>Nama File:</strong><br>
          <span>${file.filename}</span>
        </div>

        <form action="/update/${file.id}" method="POST">
          <div class="form-group">
            <label>
              <i class="fas fa-pencil-alt"></i>
              Deskripsi File
            </label>
            <input 
              type="text" 
              name="description" 
              value="${file.description || ""}" 
              placeholder="Masukkan deskripsi baru"
              required
            />
          </div>

          <div class="buttons">
            <button type="submit" class="btn btn-primary">
              <i class="fas fa-save"></i>
              Simpan
            </button>
            <a href="/files" class="btn btn-secondary">
              <i class="fas fa-times"></i>
              Batal
            </a>
          </div>
        </form>
      </div>
    </body>
    </html>
  `;
}

function generateSuccessPage(message, redirectUrl) {
  return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="refresh" content="2;url=${redirectUrl}">
      <title>Berhasil!</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }

        .container {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          padding: 60px 40px;
          max-width: 500px;
          width: 100%;
          text-align: center;
          animation: fadeIn 0.5s ease;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .success-icon {
          width: 80px;
          height: 80px;
          background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 25px;
          animation: scaleIn 0.5s ease 0.2s both;
        }

        @keyframes scaleIn {
          from {
            transform: scale(0);
          }
          to {
            transform: scale(1);
          }
        }

        .success-icon i {
          font-size: 40px;
          color: white;
        }

        h1 {
          color: #2d3748;
          font-size: 28px;
          margin-bottom: 15px;
        }

        p {
          color: #718096;
          font-size: 16px;
          margin-bottom: 10px;
        }

        .redirect-text {
          color: #667eea;
          font-size: 14px;
          font-weight: 500;
        }

        .btn {
          display: inline-block;
          margin-top: 20px;
          padding: 12px 30px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          text-decoration: none;
          border-radius: 10px;
          font-weight: 600;
          transition: all 0.3s ease;
        }

        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">
          <i class="fas fa-check"></i>
        </div>
        <h1>Berhasil!</h1>
        <p>${message}</p>
        <p class="redirect-text">Mengalihkan dalam 2 detik...</p>
        <a href="${redirectUrl}" class="btn">Lanjutkan Sekarang</a>
      </div>
    </body>
    </html>
  `;
}

function generateErrorPage(message) {
  return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Error!</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }

        .container {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          padding: 60px 40px;
          max-width: 500px;
          width: 100%;
          text-align: center;
        }

        .error-icon {
          width: 80px;
          height: 80px;
          background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 25px;
        }

        .error-icon i {
          font-size: 40px;
          color: white;
        }

        h1 {
          color: #2d3748;
          font-size: 28px;
          margin-bottom: 15px;
        }

        p {
          color: #718096;
          font-size: 16px;
          margin-bottom: 30px;
        }

        .btn {
          display: inline-block;
          padding: 12px 30px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          text-decoration: none;
          border-radius: 10px;
          font-weight: 600;
          transition: all 0.3s ease;
        }

        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="error-icon">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <h1>Oops!</h1>
        <p>${message}</p>
        <a href="/" class="btn">Kembali ke Home</a>
      </div>
    </body>
    </html>
  `;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
  console.log(`📁 Upload: http://localhost:${PORT}/`);
  console.log(`📂 Files: http://localhost:${PORT}/files`);
});
