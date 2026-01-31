<script lang="ts">
    export let src: string;
</script>

<div class="pdf-viewer">
    <iframe {src} title="PDF Viewer" width="100%" height="100%" frameborder="0"></iframe>
</div>

<style>
    .pdf-viewer {
        flex: 1;
        width: 100%;
        height: 100%;
        background: #1a1a1a;
        overflow: hidden;
    }
    
    iframe {
        width: 100%;
        height: 100%;
        border: none;
    }
</style>
