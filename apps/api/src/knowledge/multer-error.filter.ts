import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { MulterError } from "multer";
import { badRequest } from "../i18n/api-exception";

/**
 * CX9: multer raises its own error type from inside FileInterceptor,
 * before the route handler runs — without this filter an oversized
 * upload would surface as a bare 500. Convert the size limit into the
 * honest Bengali 400 the rest of the upload path uses; anything else
 * is rethrown untouched.
 */
@Catch(MulterError)
export class MulterErrorFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    if (exception.code === "LIMIT_FILE_SIZE") {
      throw badRequest("knowledge.theFileIsTooLargeAt");
    }
    throw exception;
  }
}
