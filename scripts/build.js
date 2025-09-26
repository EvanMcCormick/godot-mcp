import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Make the build/index.js file executable
fs.chmodSync(path.join(__dirname, '..', 'build', 'index.js'), '755');

// Copy the scripts directory to the build directory and concatenate modules
try {
  // Ensure the build/scripts directory exists
  fs.ensureDirSync(path.join(__dirname, '..', 'build', 'scripts'));
  
  // Copy the godot_operations.gd file
  fs.copyFileSync(
    path.join(__dirname, '..', 'src', 'scripts', 'godot_operations.gd'),
    path.join(__dirname, '..', 'build', 'scripts', 'godot_operations.gd')
  );
  
  // Concatenate module .gd files if present
  const modulesDir = path.join(__dirname, '..', 'src', 'scripts', 'modules');
  if (fs.existsSync(modulesDir)) {
    const moduleFiles = fs.readdirSync(modulesDir)
      .filter(f => f.endsWith('.gd'))
      .sort(); // deterministic order
    if (moduleFiles.length > 0) {
      const targetFile = path.join(__dirname, '..', 'build', 'scripts', 'godot_operations.gd');
      let appended = '';
      for (const mf of moduleFiles) {
        const fullPath = path.join(modulesDir, mf);
        const content = fs.readFileSync(fullPath, 'utf8');
        appended += `\n# --- Begin Module: ${mf} ---\n` + content + `\n# --- End Module: ${mf} ---\n`;
      }
      fs.appendFileSync(targetFile, appended, 'utf8');
      console.log(`Appended ${moduleFiles.length} module(s) into godot_operations.gd`);
    } else {
      console.log('No module .gd files found to append.');
    }
  } else {
    console.log('Modules directory not found; skipping module concatenation.');
  }
  
  console.log('Successfully prepared godot_operations.gd with modules to build/scripts');
} catch (error) {
  console.error('Error copying scripts:', error);
  process.exit(1);
}

console.log('Build scripts completed successfully!');
