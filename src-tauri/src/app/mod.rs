use crate::file_handler::traits::FileHandler;
use crate::model_manager::traits::ModelManager;
use crate::transcriber::traits::Transcriber;
use std::sync::Arc;

pub struct AppState {
    pub transcriber: Arc<dyn Transcriber>,
    pub model_manager: Arc<dyn ModelManager>,
    pub file_handler: Arc<dyn FileHandler>,
}

impl AppState {
    pub fn new(
        transcriber: Arc<dyn Transcriber>,
        model_manager: Arc<dyn ModelManager>,
        file_handler: Arc<dyn FileHandler>,
    ) -> Self {
        Self {
            transcriber,
            model_manager,
            file_handler,
        }
    }
}
