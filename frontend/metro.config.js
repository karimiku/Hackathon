const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// GLB/GLTFファイルをアセットとして認識させる
config.resolver.assetExts.push('glb', 'gltf');

module.exports = config;


