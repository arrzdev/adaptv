import { defineApp } from "@arrzdev/adaptv/config"

//The one config file: the web manifest, the native projects, icons and theme all come
//from here. Every key is documented on its type — hover it.
export default defineApp({
  //the store identity of the iOS and Android apps; set it before the first native build
  appId: "com.example.basic",
  name: "basic",
  description: "basic, built with adaptv.",
  themeColor: { light: "#ffffff", dark: "#0a0a0c" },
  styles: "./src/styles/main.css",
  //routes live in src/routing, declared in src/routing/config.ts
  router: {},
})
