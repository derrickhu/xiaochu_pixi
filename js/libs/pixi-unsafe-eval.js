/*!
 * @pixi/unsafe-eval - v7.3.3
 * Compiled Mon, 01 Jan 2024 14:18:14 UTC
 *
 * @pixi/unsafe-eval is licensed under the MIT License.
 * http://www.opensource.org/licenses/mit-license
 *
 * 该模块替换 PixiJS ShaderSystem 中的 new Function() 调用，
 * 使其可以在禁止 unsafe-eval 的环境（如微信小游戏）中运行。
 */

(function() {
  'use strict';

  // 获取全局的 PIXI 对象
  var PIXI = (typeof GameGlobal !== 'undefined' && GameGlobal.PIXI) || 
             (typeof window !== 'undefined' && window.PIXI) || 
             (typeof globalThis !== 'undefined' && globalThis.PIXI);

  if (!PIXI) {
    console.warn('[pixi-unsafe-eval] PIXI not found, skip install');
    return;
  }

  // === 单值 uniform 同步函数 ===
  var singleSettersMap = {
    vec3: function(gl, location, cv, value) {
      if (cv[0] !== value[0] || cv[1] !== value[1] || cv[2] !== value[2]) {
        cv[0] = value[0]; cv[1] = value[1]; cv[2] = value[2];
        gl.uniform3f(location, value[0], value[1], value[2]);
      }
    },
    int: function(gl, location, cv, value) { gl.uniform1i(location, value); },
    ivec2: function(gl, location, cv, value) { gl.uniform2i(location, value[0], value[1]); },
    ivec3: function(gl, location, cv, value) { gl.uniform3i(location, value[0], value[1], value[2]); },
    ivec4: function(gl, location, cv, value) { gl.uniform4i(location, value[0], value[1], value[2], value[3]); },
    uint: function(gl, location, cv, value) { gl.uniform1ui(location, value); },
    uvec2: function(gl, location, cv, value) { gl.uniform2ui(location, value[0], value[1]); },
    uvec3: function(gl, location, cv, value) { gl.uniform3ui(location, value[0], value[1], value[2]); },
    uvec4: function(gl, location, cv, value) { gl.uniform4ui(location, value[0], value[1], value[2], value[3]); },
    bvec2: function(gl, location, cv, value) { gl.uniform2i(location, value[0], value[1]); },
    bvec3: function(gl, location, cv, value) { gl.uniform3i(location, value[0], value[1], value[2]); },
    bvec4: function(gl, location, cv, value) { gl.uniform4i(location, value[0], value[1], value[2], value[3]); },
    mat2: function(gl, location, cv, value) { gl.uniformMatrix2fv(location, false, value); },
    mat4: function(gl, location, cv, value) { gl.uniformMatrix4fv(location, false, value); }
  };

  // === 数组 uniform 同步函数 ===
  var arraySyncMap = {
    float: function(gl, location, cv, value) { gl.uniform1fv(location, value); },
    vec2: function(gl, location, cv, value) { gl.uniform2fv(location, value); },
    vec3: function(gl, location, cv, value) { gl.uniform3fv(location, value); },
    vec4: function(gl, location, cv, value) { gl.uniform4fv(location, value); },
    int: function(gl, location, cv, value) { gl.uniform1iv(location, value); },
    ivec2: function(gl, location, cv, value) { gl.uniform2iv(location, value); },
    ivec3: function(gl, location, cv, value) { gl.uniform3iv(location, value); },
    ivec4: function(gl, location, cv, value) { gl.uniform4iv(location, value); },
    uint: function(gl, location, cv, value) { gl.uniform1uiv(location, value); },
    uvec2: function(gl, location, cv, value) { gl.uniform2uiv(location, value); },
    uvec3: function(gl, location, cv, value) { gl.uniform3uiv(location, value); },
    uvec4: function(gl, location, cv, value) { gl.uniform4uiv(location, value); },
    bool: function(gl, location, cv, value) { gl.uniform1iv(location, value); },
    bvec2: function(gl, location, cv, value) { gl.uniform2iv(location, value); },
    bvec3: function(gl, location, cv, value) { gl.uniform3iv(location, value); },
    bvec4: function(gl, location, cv, value) { gl.uniform4iv(location, value); },
    sampler2D: function(gl, location, cv, value) { gl.uniform1iv(location, value); },
    samplerCube: function(gl, location, cv, value) { gl.uniform1iv(location, value); },
    sampler2DArray: function(gl, location, cv, value) { gl.uniform1iv(location, value); }
  };

  // === 核心：静态 uniform 同步函数（替代 new Function 动态生成）===
  function syncUniforms(group, uniformData, syncData, uniformValues, renderer) {
    var textureCount = 0;
    var curValue = null;
    var value = null;
    var gl = renderer.gl;

    for (var uniformName in group.uniforms) {
      var data = uniformData[uniformName];
      var uValue = uniformValues[uniformName];
      var sd = syncData[uniformName];
      var uniform = group.uniforms[uniformName];

      if (!data) {
        if (uniform.group === true) {
          renderer.shader.syncUniformGroup(uValue);
        }
        continue;
      }

      if (data.type === 'float' && data.size === 1 && !data.isArray) {
        if (uValue !== sd.value) {
          sd.value = uValue;
          gl.uniform1f(sd.location, uValue);
        }
      } else if (data.type === 'bool' && data.size === 1 && !data.isArray) {
        if (uValue !== sd.value) {
          sd.value = uValue;
          gl.uniform1i(sd.location, Number(uValue));
        }
      } else if ((data.type === 'sampler2D' || data.type === 'samplerCube' || data.type === 'sampler2DArray') && data.size === 1 && !data.isArray) {
        renderer.texture.bind(uValue, textureCount);
        if (sd.value !== textureCount) {
          sd.value = textureCount;
          gl.uniform1i(sd.location, textureCount);
        }
        textureCount++;
      } else if (data.type === 'mat3' && data.size === 1 && !data.isArray) {
        if (uniform.a !== void 0) {
          gl.uniformMatrix3fv(sd.location, false, uValue.toArray(true));
        } else {
          gl.uniformMatrix3fv(sd.location, false, uValue);
        }
      } else if (data.type === 'vec2' && data.size === 1 && !data.isArray) {
        if (uniform.x !== void 0) {
          curValue = sd.value;
          value = uValue;
          if (curValue[0] !== value.x || curValue[1] !== value.y) {
            curValue[0] = value.x;
            curValue[1] = value.y;
            gl.uniform2f(sd.location, value.x, value.y);
          }
        } else {
          curValue = sd.value;
          value = uValue;
          if (curValue[0] !== value[0] || curValue[1] !== value[1]) {
            curValue[0] = value[0];
            curValue[1] = value[1];
            gl.uniform2f(sd.location, value[0], value[1]);
          }
        }
      } else if (data.type === 'vec4' && data.size === 1 && !data.isArray) {
        if (uniform.width !== void 0) {
          curValue = sd.value;
          value = uValue;
          if (curValue[0] !== value.x || curValue[1] !== value.y || curValue[2] !== value.width || curValue[3] !== value.height) {
            curValue[0] = value.x;
            curValue[1] = value.y;
            curValue[2] = value.width;
            curValue[3] = value.height;
            gl.uniform4f(sd.location, value.x, value.y, value.width, value.height);
          }
        } else {
          curValue = sd.value;
          value = uValue;
          if (curValue[0] !== value[0] || curValue[1] !== value[1] || curValue[2] !== value[2] || curValue[3] !== value[3]) {
            curValue[0] = value[0];
            curValue[1] = value[1];
            curValue[2] = value[2];
            curValue[3] = value[3];
            gl.uniform4f(sd.location, value[0], value[1], value[2], value[3]);
          }
        }
      } else {
        var syncFn = (data.size === 1 && !data.isArray) ? singleSettersMap : arraySyncMap;
        var setter = syncFn[data.type];
        if (setter) {
          setter.call(null, gl, sd.location, sd.value, uValue);
        }
      }
    }
  }

  // === 安装：替换 ShaderSystem 原型方法 ===
  function install() {
    if (!PIXI.ShaderSystem) {
      console.warn('[pixi-unsafe-eval] PIXI.ShaderSystem not found');
      return;
    }
    Object.assign(PIXI.ShaderSystem.prototype, {
      systemCheck: function() {
        // 跳过 unsafe-eval 检查 — 不再需要
      },
      syncUniforms: function(group, glProgram) {
        var shader = this.shader;
        var renderer = this.renderer;
        syncUniforms(
          group,
          shader.program.uniformData,
          glProgram.uniformData,
          group.uniforms,
          renderer
        );
      }
    });
    console.log('[pixi-unsafe-eval] installed successfully');
  }

  // 自动安装
  install();

})();
